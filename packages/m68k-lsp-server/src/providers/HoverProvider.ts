import type { MacroExpansionResult } from "@m68k-lsp/protocol";
import type {
  DirectiveNode,
  ExpressionNode,
  InstructionNode,
  NumericLiteralNode,
  SizeNode,
  SpecialRegisterNode,
  StringLiteralNode,
} from "m68k-parser";
import * as lsp from "vscode-languageserver";
import { type TextDocument } from "vscode-languageserver-textdocument";
import { type Provider } from ".";
import { childNodes, type AstNode, type AstPath, nodeAtPosition } from "../ast";
import {
  addressingMode,
  type AddressingModeName,
  encodedInstruction,
  evaluateConstant,
  isLocalLabelName,
  locationAsRange,
  type OperandNode,
  parseExpression,
  parseLine,
} from "m68k-parser";
import { resolveInclude } from "../files";
import { DefinitionType, escapeMarkdown, getDefinitions } from "../symbols";
import {
  type RoutineRegisters,
  canonicalGeneralPurposeRegister,
  createAliasResolver,
  registerName,
  routineRegisters,
} from "../registerAnalysis";
import {
  describeRegister,
  routineContract,
  type RegisterDescriptionResult,
} from "../registerDescriptions";
import {
  instructionFormDocs,
  mnemonicDocs,
  registerDocs,
  sizeDocs,
} from "../docs/index";
import type { Size } from "m68k-parser";
import { type RegisterName } from "../syntax";
import { type Context } from "../context";
import { isProcessed, type ProcessedDocument } from "../DocumentProcessor";
import {
  formatDeclaration,
  formatMnemonicDoc,
  formatNumber,
  formatNumeric,
} from "../formatting";
import { type MarkupContent } from "vscode-languageserver";
import { expandMacroAtLine } from "../macros";
import { copperDocs } from "../amigaCopper";
import { libraryFunctionDocs } from "../amigaLibraries";
import {
  ciaAccess,
  ciaBitDocs,
  ciaOperand,
  ciaSymbolDocs,
  ciaWriteDocs,
} from "../amigaCia";
import {
  amigaHardwareDocs,
  registerWrite,
  registerWriteDocs,
  standardFlagValue,
} from "../amigaHardware";
import { type AliasResolver, registersAt } from "../registerEffects";
import { analyzeDocumentConditionals } from "../documentConditionals";

const macroHoverColumnLimit = 200;

/**
 * How a value is written in hover: decimal then hexadecimal, hexadecimal then
 * decimal where the source writes it in hexadecimal, or hexadecimal alone for
 * an address, which nobody reads in decimal.
 */
type ValueStyle = "decimal" | "hex" | "address";

function formatEvaluatedValue(
  value: number,
  style: ValueStyle = "decimal",
): string {
  const hex = "$" + (value >>> 0).toString(16).toUpperCase();
  if (style === "address") return hex;
  if (style === "hex") return `${hex} (${value})`;
  return `${value} (${hex})`;
}

/**
 * Whether the operand at `path` holds an address, as its addressing mode says:
 * an absolute address, as in `lea custom,a6` or `move.w d0,custom+intena`, a
 * PC-relative target, or an immediate moved into an address register. A
 * displacement from a register, such as `intena(a6)` or `_LVOOpenLibrary(a6)`,
 * is an offset rather than an address.
 */
function isAddressOperand(path: AstPath): boolean {
  const { line } = path;
  const operands = line.operands ?? [];
  const operand = [...path.ancestors, path.node].find((node) =>
    (operands as AstNode[]).includes(node),
  );
  if (!operand || line.mnemonic?.type !== "instruction") return false;
  if (
    operand.type === "absolute-address" ||
    operand.type === "pc-relative" ||
    operand.type === "pc-relative-index"
  )
    return true;
  const mnemonic = line.mnemonic.instruction.toLowerCase();
  return (
    operand.type === "immediate" &&
    operand === (operands[0] as AstNode) &&
    operands[1]?.type === "address-register" &&
    (mnemonic === "move" || mnemonic === "movea")
  );
}

export default class HoverProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onHover(params: lsp.HoverParams): Promise<lsp.Hover | undefined> {
    const hover = await this.hoverAt(params);
    const processed = this.ctx.store.get(params.textDocument.uri);
    if (!isProcessed(processed)) return hover;
    const path = nodeAtPosition(processed.parsed, params.position);
    const docs = path && this.hardwareDocs(processed, path, params.position);
    return docs
      ? withDocs(hover, docs, path.node.loc, params.position.line)
      : hover;
  }

  /**
   * Documentation for an Amiga register, flag or library function the hovered
   * symbol names, or a label defining one, checked against the symbol's value
   * where it is known.
   */
  private hardwareDocs(
    processed: ProcessedDocument,
    path: AstPath,
    position: lsp.Position,
  ): string | undefined {
    const { node, line } = path;
    const { evaluateAtLine } = analyzeDocumentConditionals(
      this.ctx,
      processed.uri,
      processed.parsed,
      processed.blocks,
      position.line,
    );
    const docs: string[] = [];
    const lookup = (symbolName: string) => {
      const parsed = parseExpression(symbolName);
      return parsed.errors.length ? undefined : evaluateAtLine?.(parsed.value);
    };
    const operands = (line.operands ?? []) as AstNode[];
    const index = operands.findIndex(
      (operand) => operand === node || path.ancestors.includes(operand),
    );
    // A CIA register operand, which can say which CIA a symbol in it means.
    const cia =
      index >= 0 && line.operands
        ? ciaOperand(line.operands[index], lookup)
        : undefined;

    const name =
      node.type === "symbol"
        ? (node as unknown as { name: string }).name
        : node.type === "label"
          ? line.label?.label
          : undefined;
    if (name) {
      const value = lookup(name);
      const symbolDocs =
        amigaHardwareDocs(name, value) ??
        ciaSymbolDocs(name, value, cia?.cia) ??
        libraryFunctionDocs(name, value, line);
      if (symbolDocs) docs.push(symbolDocs);
    }

    // A bit tested or changed in a CIA register, or a byte written to one.
    const access = index >= 0 ? ciaAccess(line, index, lookup) : undefined;
    const accessValue =
      access &&
      evaluateAtLine &&
      (evaluateAtLine(access.value) ??
        evaluateWithStandardFlags(access.value, evaluateAtLine));
    if (access && accessValue !== undefined) {
      const accessDocs =
        access.kind === "bit"
          ? ciaBitDocs(access.operand, accessValue)
          : ciaWriteDocs(access.operand, accessValue);
      if (accessDocs) docs.push(accessDocs);
    }

    // A Copper instruction written as numbers.
    const copper =
      index >= 0
        ? copperDocs(processed.parsed, position.line, index, lookup)
        : undefined;
    if (copper) docs.push(copper);

    // A value written to a named register, read against its bits.
    const write = index >= 0 ? registerWrite(line, index) : undefined;
    // Flags the project does not define take the includes' values.
    const value =
      write &&
      evaluateAtLine &&
      (evaluateAtLine(write.value) ??
        evaluateWithStandardFlags(write.value, evaluateAtLine));
    if (write && value !== undefined) {
      const writeDocs = registerWriteDocs(
        write.register.name,
        evaluateAtLine?.(write.register),
        value,
      );
      if (writeDocs) docs.push(writeDocs);
    }
    return docs.length ? docs.join("\n\n") : undefined;
  }

  private async hoverAt({
    textDocument,
    position,
  }: lsp.HoverParams): Promise<lsp.Hover | undefined> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) {
      return;
    }

    const path = nodeAtPosition(processed.parsed, position);
    if (!path) {
      return;
    }
    const { node, line } = path;
    const compound = [...path.ancestors, node].find(
      ({ type }) =>
        type === "binary-op" || type === "unary-op" || type === "group",
    ) as ExpressionNode | undefined;
    const symbolExpression =
      node.type === "symbol" ? (node as ExpressionNode) : undefined;
    let expression = compound ?? symbolExpression;
    if (
      !expression &&
      [
        "immediate",
        "absolute-address",
        "value",
        "address-register-indirect-displacement",
        "pc-relative",
      ].includes(node.type)
    ) {
      const [operand] = childNodes(node);
      if (
        operand &&
        [
          "binary-op",
          "unary-op",
          "group",
          "numeric-literal",
          "symbol",
        ].includes(operand.type)
      ) {
        if (operand.type === "numeric-literal") {
          const hover = await this.hoverNumber(
            operand as NumericLiteralNode,
            position.line,
          );
          return { ...hover, range: locationAsRange(node.loc, position.line) };
        }
        expression = operand as ExpressionNode;
      }
    }
    if (
      !expression &&
      node.type === "label" &&
      line.mnemonic?.type === "directive" &&
      ["equ", "=", "set"].includes(line.mnemonic.directive)
    ) {
      const operand = line.operands?.[0];
      if (operand?.type === "value") expression = operand.value;
      else if (operand?.type === "string-literal") expression = operand;
    }
    // An offset's label stands for the counter, so it is the label that is
    // evaluated, as if it were used where it is defined.
    if (
      !expression &&
      node.type === "label" &&
      line.mnemonic?.type === "directive" &&
      ["rs", "so", "fo"].includes(line.mnemonic.directive) &&
      line.label
    ) {
      const parsedLabel = parseExpression(line.label.label);
      if (!parsedLabel.errors.length) expression = parsedLabel.value;
    }
    if (expression) {
      const { evaluateAtLine } = analyzeDocumentConditionals(
        this.ctx,
        processed.uri,
        processed.parsed,
        processed.blocks,
        position.line,
      );
      const value = evaluateAtLine?.(expression);
      const symbolValue = symbolExpression
        ? expression === symbolExpression
          ? value
          : evaluateAtLine?.(symbolExpression)
        : node.type === "label"
          ? value
          : undefined;
      if (value !== undefined || symbolValue !== undefined) {
        const symbol =
          node.type === "symbol" || node.type === "label"
            ? await this.hoverSymbol(node, processed.document, position)
            : undefined;
        const contents = [...(symbol?.contents ?? [])];
        const declarationIndex = contents.findIndex(
          (part) => typeof part !== "string",
        );
        const declaration = contents[declarationIndex];
        const code: string[] = [];
        let shown = symbolValue;
        // Every value in an address operand is shown as an address.
        const style: ValueStyle = isAddressOperand(path)
          ? "address"
          : "decimal";
        if (declaration && typeof declaration !== "string") {
          code.push(declaration.value);
          contents.splice(declarationIndex, 1);
        }
        if (symbolValue !== undefined) {
          if (code.length) {
            const original = code[0];
            const { value: parsed, errors } = parseLine(original);
            const operand = parsed.operands?.[0];
            // An offset's operand is a count, not its value.
            const assigns =
              parsed.mnemonic?.type === "directive" &&
              ["equ", "=", "set"].includes(parsed.mnemonic.directive);
            const expr =
              assigns && operand?.type === "value" ? operand.value : undefined;
            const literal =
              expr?.type === "numeric-literal" ||
              (expr?.type === "unary-op" &&
                (expr.operator === "+" || expr.operator === "-") &&
                expr.operand.type === "numeric-literal");
            const result =
              literal && !errors.length ? evaluateConstant(expr) : undefined;
            // A literal written in hexadecimal keeps it first.
            const written = expr?.type === "unary-op" ? expr.operand : expr;
            const formatted = formatEvaluatedValue(
              symbolValue,
              style === "decimal" &&
                written?.type === "numeric-literal" &&
                written.format === "hex"
                ? "hex"
                : style,
            );
            if (expr && result?.known && result.value === symbolValue) {
              code[0] =
                original.slice(0, expr.loc.start) +
                formatted +
                original.slice(expr.loc.end);
            } else {
              const indent = /^[^=\s]+\s*/.exec(original)?.[0].length ?? 0;
              code.push(
                " ".repeat(indent) +
                  "= " +
                  formatEvaluatedValue(symbolValue, style),
              );
            }
          } else {
            const name = processed.document.getText(
              locationAsRange(node.loc, position.line),
            );
            code.push(name + " = " + formatEvaluatedValue(symbolValue, style));
          }
        }
        if (
          value !== undefined &&
          expression !== symbolExpression &&
          node.type !== "label"
        ) {
          const name =
            expression.type === "symbol"
              ? processed.document.getText(
                  locationAsRange(expression.loc, position.line),
                )
              : "Expression";
          code.push(name + " = " + formatEvaluatedValue(value, style));
          shown = value;
        }
        return {
          range: locationAsRange(
            (node.type === "label" || value === undefined ? node : expression)
              .loc,
            position.line,
          ),
          contents: [
            ...contents,
            { language: processed.document.languageId, value: code.join("\n") },
            // The value last shown in every form, as a literal's hover shows it.
            ...(shown !== undefined ? [formatNumber(shown)] : []),
          ],
        };
      }
    }

    switch (node.type) {
      case "instruction":
        return this.hoverInstruction(
          (node as unknown as InstructionNode).instruction,
          line.operands ?? [],
          node,
          textDocument.uri,
          position.line,
        );
      case "directive":
        return this.hoverMnemonic(
          (node as unknown as DirectiveNode).directive,
          node,
          "directive",
          position.line,
        );
      case "macro": {
        const expansion = expandMacroAtLine(this.ctx, processed, position.line);
        const contents = expansion
          ? formatMacroHover(expansion)
          : // Some documented directives parse as unknown mnemonics.
            line.mnemonic?.type === "macro"
            ? lookupMnemonicDoc(line.mnemonic.macro)
            : undefined;
        if (contents) {
          return { range: locationAsRange(node.loc, position.line), contents };
        }
        break;
      }
      case "size":
        return this.hoverSize(node, position.line);
      // A label is the definition site of a symbol; both resolve through the
      // symbol table, which is what hoverSymbol consults.
      case "symbol":
      case "label":
        return this.hoverSymbol(node, processed.document, position);
      case "string-literal": {
        const directive =
          line.mnemonic?.type === "directive"
            ? line.mnemonic.directive.toLowerCase()
            : undefined;
        if (
          directive === "include" ||
          directive === "incdir" ||
          directive === "incbin"
        ) {
          return this.hoverPath(
            node as unknown as StringLiteralNode,
            textDocument.uri,
            position.line,
          );
        }
        break;
      }
      case "numeric-literal":
        return this.hoverNumber(
          node as unknown as NumericLiteralNode,
          position.line,
        );
      case "special-register":
        return this.hoverRegister(
          node as unknown as SpecialRegisterNode,
          position.line,
        );
      case "data-register":
      case "address-register":
        return this.hoverGeneralRegister(node, textDocument.uri, position);
      case "register-list":
        return this.hoverRegisterList(node, textDocument.uri, position);
    }
  }

  register(connection: lsp.Connection) {
    connection.onHover(this.onHover.bind(this));
    return {
      hoverProvider: true,
    };
  }

  private async hoverMnemonic(
    text: string,
    node: AstNode,
    kind: "instruction" | "directive",
    line: number,
  ) {
    const docs = lookupMnemonicDoc(text);
    return {
      range: locationAsRange(node.loc, line),
      contents: docs || {
        kind: lsp.MarkupKind.PlainText,
        value: `(${kind}) ` + text.toUpperCase(),
      },
    };
  }

  /**
   * Documents the instruction the line is encoded as, which the operands can
   * change: `cmp.w d0,a0` is CMPA and `add.w #1,(a0)` is ADDI. Where the
   * reference gives a form a page of its own, such as MOVE to CCR, that page
   * is shown rather than the entry combining every form.
   */
  private async hoverInstruction(
    text: string,
    operands: readonly OperandNode[],
    node: AstNode,
    uri: string,
    line: number,
  ) {
    const modes = operandModes(operands, createAliasResolver(this.ctx, uri));
    const encoded = encodedInstruction(text, modes);
    const form = instructionForm(encoded, modes);
    const doc = form ? instructionFormDocs[form] : mnemonicDocs[encoded];
    if (!doc) {
      return this.hoverMnemonic(text, node, "instruction", line);
    }
    const docs = formatMnemonicDoc(doc);
    const written = text.toLowerCase();
    if ((form ?? encoded) !== written) {
      // A form's title keeps the reference's casing: "MOVE to CCR".
      const title = form ? doc.title : encoded.toUpperCase();
      docs.value = `Assembled as **${title}**\n${docs.value}`;
    }
    return { range: locationAsRange(node.loc, line), contents: docs };
  }

  private async hoverSize(node: AstNode, line: number) {
    const size = (node as unknown as SizeNode).size;
    const sizeDoc = sizeDocs[size.toLowerCase() as Size];
    return {
      range: locationAsRange(node.loc, line),
      contents: {
        kind: lsp.MarkupKind.PlainText,
        value: sizeDoc || "(size)",
      },
    };
  }

  private async hoverSymbol(
    node: AstNode,
    document: TextDocument,
    position: lsp.Position,
  ) {
    const [def] = await getDefinitions(document.uri, position, this.ctx);
    const contents: lsp.MarkedString[] = [];

    if (def) {
      if (def.comment) {
        contents.push(def.comment); // TODO
      }

      switch (def.type) {
        case DefinitionType.Register:
        case DefinitionType.RegisterList:
        case DefinitionType.Constant:
        case DefinitionType.Offset:
        case DefinitionType.Variable: {
          // The declaration line is captured when the symbol is recorded, so
          // this works whether or not the defining file is open.
          if (def.declaration) {
            contents.push({
              language: document.languageId,
              value: formatDeclaration(def.declaration),
            });
          }
          // What an alias for a single register holds here, as for the
          // register itself.
          const [register, ...more] =
            def.type === DefinitionType.Register
              ? (createAliasResolver(this.ctx, document.uri)(def.name) ?? [])
              : [];
          const described =
            register && !more.length
              ? describeRegister(this.ctx, document.uri, position, register)
              : undefined;
          if (register && described) {
            contents.push(formatRegisterDescription(register, described));
          }
          break;
        }
        default: {
          contents.push(`(${def.type}) ${def.name}`);
          const summary =
            def.type === DefinitionType.Label && !isLocalLabelName(def.name)
              ? routineRegisters(
                  this.ctx,
                  def.location.uri,
                  def.selectionRange.start.line,
                  (name) => routineContract(this.ctx, def.location.uri, name),
                )
              : undefined;
          const text = summary && formatRoutineRegisters(summary);
          if (text) {
            contents.push(text);
          }
        }
      }

      return {
        range: locationAsRange(node.loc, position.line),
        contents,
      };
    }
  }

  private async hoverPath(node: StringLiteralNode, uri: string, line: number) {
    // The node already holds the string with its quotes removed.
    const path = node.content;
    const resolved = await resolveInclude(uri, path, this.ctx);

    return {
      range: locationAsRange(node.loc, line),
      contents: {
        kind: lsp.MarkupKind.Markdown,
        value: resolved || path,
      },
    };
  }

  private async hoverNumber(node: NumericLiteralNode, line: number) {
    return {
      range: locationAsRange(node.loc, line),
      contents: {
        kind: lsp.MarkupKind.Markdown,
        value: formatNumeric(node.raw),
      },
    };
  }

  private async hoverRegister(node: SpecialRegisterNode, line: number) {
    const doc = registerDocs[node.register.toLowerCase() as RegisterName];
    if (doc) {
      return {
        range: locationAsRange(node.loc, line),
        contents: {
          kind: lsp.MarkupKind.Markdown,
          value: doc,
        },
      };
    }
  }

  /** The descriptions of the registers in a list that have one. */
  private async hoverRegisterList(
    node: AstNode,
    uri: string,
    position: lsp.Position,
  ) {
    const registers = (node as AstNode & { registers?: unknown }).registers;
    const sections = (Array.isArray(registers) ? registers : []).flatMap(
      (item) => {
        const register = canonicalGeneralPurposeRegister(item);
        const result =
          register && describeRegister(this.ctx, uri, position, register);
        return register && result
          ? [formatRegisterDescription(register, result)]
          : [];
      },
    );
    if (!sections.length) {
      return;
    }
    return {
      range: locationAsRange(node.loc, position.line),
      contents: {
        kind: lsp.MarkupKind.Markdown,
        value: sections.join("\n\n***\n\n"),
      },
    };
  }

  private async hoverGeneralRegister(
    node: AstNode,
    uri: string,
    position: lsp.Position,
  ) {
    const register = registerName(node);
    const result =
      register && describeRegister(this.ctx, uri, position, register);
    if (!result) {
      return;
    }
    return {
      range: locationAsRange(node.loc, position.line),
      contents: {
        kind: lsp.MarkupKind.Markdown,
        value: formatRegisterDescription(register, result),
      },
    };
  }
}

function formatMacroHover({
  lines,
  incomplete,
}: MacroExpansionResult): MarkupContent {
  const shortened = lines.some((line) => line.length > macroHoverColumnLimit);
  const code = lines
    .map((line) =>
      line.length > macroHoverColumnLimit
        ? line.slice(0, macroHoverColumnLimit - 1) + "…"
        : line,
    )
    .join("\n");
  // Macro source can contain Markdown fences in assembly comments or strings.
  let fenceLength = 3;
  for (const [run] of code.matchAll(/`+/g)) {
    fenceLength = Math.max(fenceLength, run.length + 1);
  }
  const fence = "`".repeat(fenceLength);
  const preview = code
    ? `${fence}m68k\n${code}\n${fence}`
    : "The macro body is empty.";
  const note = incomplete || shortened ? "\n\nPartial preview." : "";
  return {
    kind: lsp.MarkupKind.Markdown,
    value: `**Macro expansion**\n\n${preview}${note}`,
  };
}

/**
 * What a routine does with registers, as `Reads D0 · Modifies D0–D1/A0`,
 * noting where code it runs could not be analysed.
 */
function formatRoutineRegisters(summary: RoutineRegisters): string | undefined {
  const reads =
    summary.reads.length || summary.mayReadOthers
      ? `Reads ${
          summary.reads.length
            ? formatRegisterList(summary.reads) +
              (summary.mayReadOthers ? " and possibly others" : "")
            : "possibly any"
        }`
      : undefined;
  // What code that could not be analysed may change, unless it is saved on
  // the stack around that code. Named when it is not everything left.
  // The stack pointer is never in a summary, so D0-D7 and A0-A6 are all.
  const others = 15 - summary.modifies.length;
  const possibly = summary.mayModify.length
    ? summary.mayModify.length === others
      ? summary.modifies.length
        ? "and possibly others"
        : "possibly any"
      : `${summary.modifies.length ? "and possibly " : "possibly "}${formatRegisterList(summary.mayModify)}`
    : undefined;
  const modifies =
    summary.modifies.length || possibly
      ? `Modifies ${[
          summary.modifies.length
            ? formatRegisterList(summary.modifies)
            : undefined,
          possibly,
        ]
          .filter(Boolean)
          .join(" ")}`
      : undefined;
  const parts = [reads, modifies].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** Registers in MOVEM-list form: `D0–D2/A0`. */
function formatRegisterList(registers: string[]): string {
  const groups: string[] = [];
  for (const kind of ["d", "a"]) {
    const numbers = registers
      .filter((register) => register[0] === kind)
      .map((register) => Number(register[1]))
      .sort((a, b) => a - b);
    for (let i = 0; i < numbers.length; i++) {
      let j = i;
      while (numbers[j + 1] === numbers[j] + 1) {
        j++;
      }
      const first = `${kind.toUpperCase()}${numbers[i]}`;
      groups.push(
        j === i ? first : `${first}–${kind.toUpperCase()}${numbers[j]}`,
      );
      i = j;
    }
  }
  return groups.join("/");
}

function formatRegisterDescription(
  register: string,
  { current, output, routine }: RegisterDescriptionResult,
): string {
  const name = `**${register.toUpperCase()}**`;
  const sections: string[] = [];
  if (current) {
    const text = [
      escapeMarkdown(current.text),
      ...(current.code ? ["`" + current.code + "`"] : []),
    ]
      .filter(Boolean)
      .join(" ");
    const line = current.line + 1;
    const origin = {
      header: `Input, header of ${escapeMarkdown(current.routine ?? "")}`,
      comment: `Comment, line ${line}`,
      "inferred-comment": `Inferred from comment, line ${line}`,
      operand: `Assigned on line ${line}`,
      call: `Output of ${escapeMarkdown(current.routine ?? "")}, line ${line}`,
    }[current.source];
    sections.push(`${name}: ${text}`, `*${origin}*`);
  }
  if (output) {
    const target = routine ? ` of ${escapeMarkdown(routine)}` : "";
    sections.push(
      current
        ? `Output${target}: ${escapeMarkdown(output)}`
        : `${name}: output${target}, ${escapeMarkdown(output)}`,
    );
  }
  return sections.join("\n\n");
}

/**
 * Addressing modes of a line's operands, reading a register alias written as
 * a whole operand (`count` for `count equr d0`) as the register it names.
 */
function operandModes(
  operands: readonly OperandNode[],
  aliases: AliasResolver,
): (AddressingModeName | undefined)[] {
  return operands.map((operand) => {
    if (operand.type === "absolute-address") {
      const [alias] = registersAt(operand, aliases);
      if (alias) {
        // A list alias has no single mode; leave the form to the mnemonic.
        if (alias.registers.length !== 1) return undefined;
        return alias.registers[0].startsWith("a") ? "an" : "dn";
      }
    }
    return addressingMode(operand);
  });
}

/**
 * The key of the separately documented form an encoded instruction takes with
 * these operands, such as "move to ccr", or undefined if it has none or an
 * operand's mode is not known, when the combined entry is the safer answer.
 */
function instructionForm(
  encoded: string,
  modes: readonly (AddressingModeName | undefined)[],
): string | undefined {
  if (!instructionFormDocs[encoded] || modes.includes(undefined)) return;
  const [source, destination] = modes;
  let form = encoded;
  if (encoded === "move" && (source === "usp" || destination === "usp")) {
    form = "move usp";
  } else if (destination === "ccr" || destination === "sr") {
    form = `${encoded} to ${destination}`;
  } else if (encoded === "move" && (source === "ccr" || source === "sr")) {
    form = `move from ${source}`;
  }
  return instructionFormDocs[form] ? form : undefined;
}

/**
 * An expression's value where some of its symbols are standard Amiga flags the
 * project does not define, read as the includes define them.
 */
function evaluateWithStandardFlags(
  expr: ExpressionNode,
  evaluateAtLine: (expr: ExpressionNode) => number | undefined,
): number | undefined {
  const result = evaluateConstant(expr, (name) => {
    const symbol = parseExpression(name);
    const own = symbol.errors.length ? undefined : evaluateAtLine(symbol.value);
    return own ?? standardFlagValue(name);
  });
  return result.known ? result.value : undefined;
}

/** A hover with Markdown documentation added beneath what it already shows. */
function withDocs(
  hover: lsp.Hover | undefined,
  docs: string,
  loc: AstNode["loc"],
  line: number,
): lsp.Hover {
  if (!hover) {
    return {
      range: locationAsRange(loc, line),
      contents: { kind: lsp.MarkupKind.Markdown, value: docs },
    };
  }
  const { contents } = hover;
  if (Array.isArray(contents))
    return { ...hover, contents: [...contents, docs] };
  if (lsp.MarkupContent.is(contents))
    return {
      ...hover,
      contents: { ...contents, value: `${contents.value}\n\n---\n\n${docs}` },
    };
  return { ...hover, contents: [contents, docs] };
}

function lookupMnemonicDoc(mnemonic: string): MarkupContent | undefined {
  mnemonic = mnemonic.toLowerCase();
  if (mnemonicDocs[mnemonic]) {
    return formatMnemonicDoc(mnemonicDocs[mnemonic]);
  }
}
