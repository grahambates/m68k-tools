import type {
  BlockStructure,
  ParsedFile,
  ParsedLine,
  SymbolNode,
} from "m68k-parser";
import { blockAt, isLocalLabelName, symbolKey } from "m68k-parser";
import * as lsp from "vscode-languageserver";
import { type AstNode, childNodes, descendants } from "./ast";
import { getUnitFilesByDistance } from "./files";
import { isProcessed } from "./DocumentProcessor";
import { containsPosition, locationAsRange } from "m68k-parser";
import { type Context } from "./context";
import { symbolsCaseSensitive } from "./config";

export interface NamedSymbol {
  location: lsp.Location;
  name: string;
}

export interface Literal {
  location: lsp.Location;
  text: string;
}

export interface Definition extends NamedSymbol {
  type: DefinitionType;
  selectionRange: lsp.Range;
  locals?: Map<string, Definition>;
  comment?: string;
  /**
   * Source line of the definition, for the kinds hover shows as a code block.
   *
   * Captured here so hover does not depend on the defining file being open:
   * most files in a workspace are indexed rather than processed, and have no
   * text to read back.
   */
  declaration?: string;
}

export function isDefinition(symbol: NamedSymbol): symbol is Definition {
  return (symbol as Definition).selectionRange !== undefined;
}

export enum DefinitionType {
  Section = "section",
  Label = "label",
  Constant = "constant",
  Variable = "variable",
  Register = "register",
  RegisterList = "register_list",
  Offset = "offset",
  Macro = "macro",
  XRef = "xref",
}

/** A `bsr`/`jsr` call site, for call hierarchy. */
export interface CallSite {
  /** Name of the enclosing global label the call is made from, if any. */
  caller?: string;
  /** Name of the label being called. */
  target: string;
  /** Location of the call target operand itself, not the whole instruction. */
  location: lsp.Location;
}

export interface Symbols {
  definitions: Map<string, Definition>;
  references: Map<string, NamedSymbol[]>;
  includes: Literal[];
  incDirs: Literal[];
  calls: CallSite[];
}

type Directive = string;

/** Definition kinds hover renders as a declaration. */
const declarationTypes = new Set([
  DefinitionType.Constant,
  DefinitionType.Variable,
  DefinitionType.Register,
  DefinitionType.RegisterList,
]);

/** Definitions named by the line's label. */
const labelDefinitions: Record<Directive, DefinitionType> = {
  equ: DefinitionType.Constant,
  fequ: DefinitionType.Constant,
  "=": DefinitionType.Constant,
  set: DefinitionType.Variable,
  rs: DefinitionType.Offset,
  equr: DefinitionType.Register,
  fequr: DefinitionType.Register,
  equrl: DefinitionType.RegisterList,
  fequrl: DefinitionType.RegisterList,
  reg: DefinitionType.RegisterList,
  freg: DefinitionType.RegisterList,
  macro: DefinitionType.Macro,
};

/** Directives whose operands name registers, not symbols to resolve. */
const registerDefinitions = new Set([
  "equr",
  "fequr",
  "equrl",
  "fequrl",
  "reg",
  "freg",
]);

/** Directives that declare symbols defined elsewhere. */
const externalDefinitions = new Set(["xref", "nref"]);

/** Instructions that call a subroutine, for call hierarchy. */
const callInstructions = new Set(["bsr", "jsr"]);

function isCallInstruction(line: ParsedLine): boolean {
  return (
    line.mnemonic?.type === "instruction" &&
    callInstructions.has(line.mnemonic.instruction.toLowerCase())
  );
}

/** First symbol named by an instruction's operands, however deeply nested. */
function callTargetSymbol(
  operands: AstNode[] | undefined,
): SymbolNode | undefined {
  for (const operand of operands ?? []) {
    for (const node of [operand, ...descendants(operand)]) {
      if (node.type === "symbol") {
        return node as unknown as SymbolNode;
      }
    }
  }
  return undefined;
}

function directiveOf(line: ParsedLine): Directive | undefined {
  return line.mnemonic?.type === "directive"
    ? line.mnemonic.directive.toLowerCase()
    : undefined;
}

/**
 * Column at which a line's definition ends.
 *
 * Trailing comments are excluded, and colons count as part of a label so that
 * `foo:` covers the colon.
 */
function endOfDefinition(line: ParsedLine, lineText: string): number {
  let end = 0;
  if (line.label) {
    end = line.label.loc.end;
    while (lineText[end] === ":") {
      end++;
    }
  }
  for (const loc of [line.mnemonic?.loc, line.qualifier?.loc]) {
    if (loc) {
      end = Math.max(end, loc.end);
    }
  }
  const last = line.operands?.[line.operands.length - 1];
  if (last) {
    end = Math.max(end, last.loc.end);
  }
  return end;
}

/**
 * Documentation comment for a definition.
 *
 * A comment on the same line wins; failing that, the run of comment-only lines
 * directly above it is used.
 */
function commentFor(
  lines: ParsedLine[],
  lineTexts: string[],
  index: number,
): string | undefined {
  const commentLines: string[] = [];
  // The comment node holds its content with the prefix stripped, but the
  // markdown conversion below expects the raw text, so take it from the source.
  const raw = (line: ParsedLine, at: number) => {
    const { loc } = line.comment!;
    return (lineTexts[at] ?? "").slice(loc.start, loc.end);
  };

  if (lines[index].comment) {
    commentLines.push(raw(lines[index], index));
  } else {
    for (let i = index - 1; i >= 0; i--) {
      const previous = lines[i];
      if (
        !previous.comment ||
        previous.label !== undefined ||
        previous.mnemonic !== undefined
      ) {
        break;
      }
      commentLines.unshift(raw(previous, i));
    }
  }

  if (!commentLines.length) {
    return undefined;
  }

  // Convert to markdown:
  const horizontalRule = "***";
  const processedLines = commentLines.map((l) =>
    l
      // Remove comment char and leading whitespace from each line
      .replace(/^[;*]\s?/, "")
      // Convert repeated punctuation lines to MD horizontal rules
      // This looks better and avoids creating headings with --- or === underline style
      // Use a tmp placeholder string until special chars are escaped
      .replace(/^\s*[*-=]{3,}\s*$/, "~~~")
      // Escape special chars
      .replace(/([*_{}[\]()#+-.!`])/g, "\\$1")
      // Replace placholder with actual rule
      .replace(/^~~~$/, horizontalRule),
  );
  // Ensure no horizontal rules at start or end of block
  while (processedLines[0] === horizontalRule) {
    processedLines.shift();
  }
  while (processedLines[processedLines.length - 1] === horizontalRule) {
    processedLines.pop();
  }

  return processedLines.join("  \n");
}

/**
 * The key a symbol name is stored and looked up by: the name itself, or its
 * lower-case form where the project folds case (see `symbolsCaseSensitive`).
 */
export function keyFor(ctx: Context, name: string): string {
  return symbolKey(name, symbolsCaseSensitive(ctx.config));
}

/**
 * Process symbols in document
 */
export function processSymbols(
  uri: string,
  parsed: ParsedFile,
  blocks: BlockStructure,
  text: string,
  caseSensitive = true,
): Symbols {
  const keyOf = (name: string) => symbolKey(name, caseSensitive);
  const symbols: Symbols = {
    definitions: new Map<string, Definition>(),
    references: new Map<string, NamedSymbol[]>(),
    includes: [],
    incDirs: [],
    calls: [],
  };

  const lineTexts = text.split(/\r?\n/g);
  let lastGlobalLabel: Definition | undefined;

  function addDefinition(
    name: string,
    interpolated: boolean,
    type: DefinitionType,
    selectionRange: lsp.Range,
    range: lsp.Range,
    index: number,
  ) {
    // Already defined in this doc?
    if (symbols.definitions.has(keyOf(name))) {
      return;
    }

    // A name embedding a macro placeholder, such as `.loop\@`, is a template
    // resolved per expansion rather than a symbol that exists as written.
    if (interpolated) {
      return;
    }

    const def: Definition = {
      name,
      type,
      location: { uri, range },
      selectionRange,
    };

    const comment = commentFor(parsed.lines, lineTexts, index);
    if (comment) {
      def.comment = comment;
    }

    if (declarationTypes.has(type)) {
      def.declaration = lineTexts[index];
    }

    if (type === DefinitionType.Label) {
      if (isLocalLabel(name)) {
        if (lastGlobalLabel) {
          lastGlobalLabel.locals?.set(keyOf(name), def);
          return;
        }
      } else {
        lastGlobalLabel = def;
        def.locals = new Map();
      }
    }

    symbols.definitions.set(keyOf(name), def);
  }

  function addReference(name: string, range: lsp.Range, interpolated: boolean) {
    if (interpolated) {
      return;
    }
    let refs = symbols.references.get(keyOf(name));
    if (!refs) {
      refs = [];
      symbols.references.set(keyOf(name), refs);
    }
    refs.push({ name, location: { uri, range } });
  }

  for (const [index, line] of parsed.lines.entries()) {
    const lineText = lineTexts[index] ?? "";
    const directive = directiveOf(line);

    // Whole-line extent of a definition on this line, which for a macro runs
    // to its `endm`.
    const start = line.label?.loc.start ?? line.mnemonic?.loc.start ?? 0;
    let endLine = index;
    let end = endOfDefinition(line, lineText);
    if (directive === "macro") {
      // A macro definition covers its whole body, up to and including `endm`.
      const block = blockAt(blocks, index);
      if (block?.kind === "macro" && block.end !== undefined) {
        endLine = block.end;
        end = endOfDefinition(parsed.lines[endLine], lineTexts[endLine] ?? "");
      }
    }
    const range = lsp.Range.create(index, start, endLine, end);

    // Include paths are recorded rather than treated as symbols.
    if (directive === "include" || directive === "incdir") {
      const operand = line.operands?.[0];
      if (operand?.type === "string-literal") {
        const literal = {
          location: { uri, range: locationAsRange(operand.loc, index) },
          text: processPath(lineText.slice(operand.loc.start, operand.loc.end)),
        };
        (directive === "include" ? symbols.includes : symbols.incDirs).push(
          literal,
        );
      }
      continue;
    }

    // `section name,type` names the section in its first operand.
    if (directive === "section") {
      const name = line.operands?.[0] && symbolIn(line.operands[0]);
      if (name) {
        addDefinition(
          name.name,
          name.interpolated === true,
          DefinitionType.Section,
          locationAsRange(name.loc, index),
          range,
          index,
        );
      }
      continue;
    }

    // `xref`/`nref` declare each operand as defined elsewhere.
    if (directive && externalDefinitions.has(directive)) {
      for (const operand of line.operands ?? []) {
        const name = symbolIn(operand);
        if (name) {
          addDefinition(
            name.name,
            name.interpolated === true,
            DefinitionType.XRef,
            locationAsRange(name.loc, index),
            range,
            index,
          );
        }
      }
      continue;
    }

    if (line.label) {
      const type =
        (directive !== undefined ? labelDefinitions[directive] : undefined) ??
        DefinitionType.Label;
      addDefinition(
        line.label.label,
        line.label.interpolated === true,
        type,
        locationAsRange(line.label.loc, index),
        range,
        index,
      );
    }

    if (isCallInstruction(line)) {
      const target = callTargetSymbol(line.operands);
      if (target && target.interpolated !== true) {
        symbols.calls.push({
          caller: lastGlobalLabel?.name,
          target: target.name,
          location: { uri, range: locationAsRange(target.loc, index) },
        });
      }
    }

    // Operands of a register equate name registers, not symbols.
    if (directive && registerDefinitions.has(directive)) {
      continue;
    }

    for (const operand of line.operands ?? []) {
      for (const node of [operand, ...descendants(operand)]) {
        if (node.type === "symbol") {
          const { name, interpolated } = node as unknown as SymbolNode;
          addReference(
            name,
            locationAsRange(node.loc, index),
            interpolated === true,
          );
        }
      }
    }
  }

  return symbols;
}

/** The symbol a directive operand wraps, if it is one. */
function symbolIn(operand: AstNode): SymbolNode | undefined {
  if (operand.type === "symbol") {
    return operand as unknown as SymbolNode;
  }
  for (const child of childNodes(operand)) {
    if (child.type === "symbol") {
      return child as unknown as SymbolNode;
    }
  }
  return undefined;
}

/**
 * Process path string - removes quotes and handles escaped chars
 */
export function processPath(path: string): string {
  if (path.startsWith('"') && path.endsWith('"')) {
    return path
      .substring(1, path.length - 1)
      .replace(/""/g, '"')
      .replace('\\"', '"');
  }
  if (path.startsWith("'") && path.endsWith("'")) {
    return path
      .substring(1, path.length - 1)
      .replace(/''/g, "'")
      .replace("\\'", "'");
  }
  return path;
}

/**
 * Get symbol at position
 */
export function symbolAtPosition(
  symbols: Symbols,
  position: lsp.Position,
): NamedSymbol | undefined {
  return (
    definitionAtPosition(symbols, position) ||
    referenceAtPosition(symbols, position)
  );
}

/**
 * Get reference symbol at position
 */
export function referenceAtPosition(
  symbols: Symbols,
  position: lsp.Position,
): NamedSymbol | undefined {
  for (const [, refs] of symbols.references) {
    const foundRef = refs.find((ref) =>
      containsPosition(ref.location.range, position),
    );
    if (foundRef) {
      return foundRef;
    }
  }
}

/**
 * Get definition symbol at position
 */
export function definitionAtPosition(
  docSymbols: Symbols,
  position: lsp.Position,
): Definition | undefined {
  for (const def of docSymbols.definitions.values()) {
    if (def.locals) {
      for (const local of def.locals.values()) {
        if (containsPosition(local.selectionRange, position)) {
          return local;
        }
      }
    }
    if (containsPosition(def.selectionRange, position)) {
      return def;
    }
  }
}

/** Whether a label name is local; the parser decides what spelling makes it so. */
export const isLocalLabel = isLocalLabelName;

/**
 * Get references to symbol at position
 */
export async function getReferences(
  uri: string,
  position: lsp.Position,
  ctx: Context,
  includeDeclaration = false,
): Promise<NamedSymbol[]> {
  const currentDoc = ctx.store.get(uri);
  if (!currentDoc) {
    return [];
  }

  const results: NamedSymbol[] = [];

  const symbol = symbolAtPosition(currentDoc.symbols, position);
  if (!symbol) {
    return [];
  }

  if (isLocalLabel(symbol.name)) {
    const { range, startLabel } = localContext(
      symbol,
      currentDoc.symbols,
      isProcessed(currentDoc) ? currentDoc.document.lineCount : Infinity,
    );
    const refs = currentDoc.symbols.references.get(keyFor(ctx, symbol.name));
    if (refs) {
      results.push(
        ...refs.filter((ref) =>
          containsPosition(range, ref.location.range.start),
        ),
      );
    }
    if (includeDeclaration) {
      const def = startLabel?.locals?.get(keyFor(ctx, symbol.name));
      if (def) {
        results.push(def);
      }
    }
  } else {
    // Current doc
    const refs = currentDoc.symbols.references.get(keyFor(ctx, symbol.name));
    if (refs) {
      results.push(...refs);
    }
    if (includeDeclaration) {
      const def = currentDoc.symbols.definitions.get(keyFor(ctx, symbol.name));
      if (def) {
        results.push(def);
      }
    }

    // A symbol can be referenced anywhere its definition is visible, which is
    // the defining file and everything that includes it. Taking the current
    // document's own includes instead would reach sibling entry points that
    // merely share a header, and a rename would then edit an unrelated file.
    const defs = await getDefinitions(uri, position, ctx);
    const scope = new Set<string>(getUnitFilesByDistance(uri, ctx));
    for (const def of defs) {
      scope.add(def.location.uri);
      for (const unitFile of getUnitFilesByDistance(def.location.uri, ctx)) {
        scope.add(unitFile);
      }
    }
    scope.delete(uri); // Already collected above

    for (const depUri of scope) {
      const dependentDoc = ctx.store.get(depUri);
      if (dependentDoc) {
        const refs = dependentDoc.symbols.references.get(
          keyFor(ctx, symbol.name),
        );
        if (refs) {
          results.push(...refs);
        }
        if (includeDeclaration) {
          const def = dependentDoc.symbols.definitions.get(
            keyFor(ctx, symbol.name),
          );
          if (def) {
            results.push(def);
          }
        }
      }
    }
  }

  return results;
}

type LocalContext = {
  range: lsp.Range;
  startLabel?: Definition;
  endLabel?: Definition;
};

/**
 * Get definitions of word at position
 */
export async function getDefinitions(
  uri: string,
  position: lsp.Position,
  ctx: Context,
): Promise<Definition[]> {
  const processed = ctx.store.get(uri);
  if (!processed) {
    return [];
  }

  const symbol = symbolAtPosition(processed.symbols, position);
  if (!symbol) {
    return [];
  }

  if (isLocalLabel(symbol.name)) {
    const globalLabel = labelBeforePosition(processed.symbols, position);
    const def = globalLabel?.locals?.get(keyFor(ctx, symbol.name));
    return def ? [def] : [];
  }

  // Definition in current doc
  const def = processed.symbols.definitions.get(keyFor(ctx, symbol.name));
  if (def) {
    return [def];
  }

  const defs: Definition[] = [];

  // Everything sharing an assembly unit with this document, which is where a
  // symbol it uses can be defined. Nearest first, so that where a name is
  // defined in more than one place the closest one is offered first rather
  // than whichever happened to be indexed earliest.
  for (const depUri of getUnitFilesByDistance(uri, ctx)) {
    const def = ctx.store
      .get(depUri)
      ?.symbols.definitions.get(keyFor(ctx, symbol.name));
    if (def) {
      defs.push(def);
    }
  }

  return defs;
}

/**
 * Resolve a definition by name rather than cursor position, for call
 * hierarchy: nearest definition in the current document, falling back to the
 * closest unit file that defines it.
 */
export function resolveDefinitionByName(
  uri: string,
  name: string,
  ctx: Context,
): Definition | undefined {
  const def = ctx.store.get(uri)?.symbols.definitions.get(keyFor(ctx, name));
  if (def) {
    return def;
  }
  for (const depUri of getUnitFilesByDistance(uri, ctx)) {
    const def = ctx.store
      .get(depUri)
      ?.symbols.definitions.get(keyFor(ctx, name));
    if (def) {
      return def;
    }
  }
  return undefined;
}

/**
 * Get definition of first global label before position
 */
export function labelBeforePosition(
  docSymbols: Symbols,
  position: lsp.Position,
): Definition | undefined {
  let label: Definition | undefined;
  for (const def of docSymbols.definitions.values()) {
    if (def.type === DefinitionType.Label && !isLocalLabel(def.name)) {
      if (def.selectionRange.start.line > position.line) {
        break;
      }
      label = def;
    }
  }
  return label;
}

/**
 * Get range between global labels containing symbol
 */
function localContext(
  symbol: NamedSymbol,
  docSymbols: Symbols,
  lineCount: number,
): LocalContext {
  const range: lsp.Range = {
    start: { character: 0, line: 0 },
    end: { character: 0, line: lineCount }, // todo
  };

  let startLabel: Definition | undefined;
  let endLabel: Definition | undefined;

  for (const def of docSymbols.definitions.values()) {
    if (def.type === DefinitionType.Label && !isLocalLabel(def.name)) {
      if (def.location.range.start.line > symbol.location.range.start.line) {
        range.end = {
          ...def.location.range.start,
          character: 0,
        };
        endLabel = def;
        break;
      }
      range.start = def.location.range.start;
      startLabel = def;
    }
  }
  return { range, startLabel, endLabel };
}

export const symbolKindMappings: Record<DefinitionType, lsp.SymbolKind> = {
  [DefinitionType.Section]: lsp.SymbolKind.Module,
  [DefinitionType.Label]: lsp.SymbolKind.Field,
  [DefinitionType.Macro]: lsp.SymbolKind.Function,
  [DefinitionType.Constant]: lsp.SymbolKind.Constant,
  [DefinitionType.Variable]: lsp.SymbolKind.Variable,
  [DefinitionType.Register]: lsp.SymbolKind.Constant,
  [DefinitionType.RegisterList]: lsp.SymbolKind.Constant,
  [DefinitionType.Offset]: lsp.SymbolKind.Constant,
  [DefinitionType.XRef]: lsp.SymbolKind.Field,
};
