import { parseBlocks } from "./block-parser.js";
import { parseLine } from "./line-parser.js";
import type {
  Block,
  BlockStructure,
  Location,
  ParsedFile,
  ParsedLine,
  ParseError,
} from "./types.js";

/**
 * Macro expansion by text substitution, the way an assembler does it.
 *
 * A call's arguments are substituted into each line of the macro body as text,
 * and the result is parsed as an ordinary line. That is what makes `d\1`,
 * `\1(a0)` and a parameter standing for a mnemonic or size come out right: the
 * assembler never sees them as anything but text either.
 *
 * Nothing here decides where definitions come from. The caller supplies a
 * lookup, so a tool working on one file, on a file and its includes, or on a
 * whole project can each use the same expansion.
 */

/** A macro definition, with its body as source text. */
export interface MacroDefinition {
  name: string;
  /** The lines between MACRO and ENDM, exactly as written. */
  body: string[];
  /** Index of the MACRO line in `ParsedFile.lines`. */
  start: number;
  /** Index of the ENDM line. */
  end: number;
}

/**
 * Every complete macro definition in a file, in source order.
 *
 * A definition is named either by its label (`Name: macro`) or by its operand
 * (`macro Name`). More than one definition of a name is reported as written, so
 * a caller that needs an unambiguous answer can tell.
 *
 * @param sourceLines the file's text split into lines, for the bodies
 * @param blocks the file's block structure, if already derived
 */
export function collectMacroDefinitions(
  file: ParsedFile,
  sourceLines: readonly string[],
  blocks: BlockStructure = parseBlocks(file),
): MacroDefinition[] {
  const definitions: MacroDefinition[] = [];

  const visit = (items: readonly Block[]) => {
    for (const block of items) {
      if (block.kind === "macro" && block.end !== undefined) {
        const operand = file.lines[block.start]?.operands?.[0];
        const name =
          block.name ??
          (operand?.type === "value" && operand.value.type === "symbol"
            ? operand.value.name
            : undefined);
        if (name)
          definitions.push({
            name,
            body: sourceLines.slice(block.start + 1, block.end),
            start: block.start,
            end: block.end,
          });
      }
      visit(block.children);
    }
  };
  visit(blocks.blocks);
  return definitions;
}

/** One argument of a call, or its size qualifier. */
export interface MacroArgument<Origin = unknown> {
  text: string;
  /** Where the text came from, handed back on every span it produces. */
  origin?: Origin;
  /**
   * The text is a whole item the caller cares about, exactly as written.
   * Carried onto spans that cover it and onto nested calls that pass it on.
   */
  literal?: boolean;
}

export interface MacroInvocation<Origin = unknown> {
  arguments: MacroArgument<Origin>[];
  /** The size the macro was called with, for `\0`. */
  qualifier?: MacroArgument<Origin>;
  /** The argument `\.`, `\+`, `\-` and CARG refer to, counted from 1. */
  carg: number;
  /** What `\@` becomes: a value distinct for each call. */
  unique?: string;
}

/** A stretch of expanded text that came from an argument. */
export interface ExpansionSpan<Origin = unknown> {
  start: number;
  end: number;
  origin: Origin;
  literal?: boolean;
}

export interface ExpandedText<Origin = unknown> {
  text: string;
  spans: ExpansionSpan<Origin>[];
}

/**
 * The invocation a macro call line makes.
 *
 * Arguments are the source text of the call's operands, taken by position so
 * that quoted and bracketed arguments stay whole rather than being split again
 * on commas.
 *
 * @param describe adds an origin, and whether the text is a `literal`, to each
 *   argument
 */
export function macroInvocation<Origin = unknown>(
  line: ParsedLine,
  lineText: string,
  describe?: (
    text: string,
    loc: Location,
  ) => Pick<MacroArgument<Origin>, "origin" | "literal">,
): MacroInvocation<Origin> {
  const argument = (loc: Location): MacroArgument<Origin> => {
    const text = lineText.slice(loc.start, loc.end);
    return { text, ...describe?.(text, loc) };
  };
  return {
    arguments: (line.operands ?? []).map((operand) => argument(operand.loc)),
    qualifier: line.qualifier ? argument(line.qualifier.loc) : undefined,
    carg: 1,
  };
}

function argumentIndex(parameter: string): number | undefined {
  if (/^[1-9]$/.test(parameter)) return Number(parameter) - 1;
  if (/^[a-z]$/i.test(parameter))
    return parameter.toLowerCase().charCodeAt(0) - "a".charCodeAt(0) + 9;
  return undefined;
}

function substitution<Origin>(
  match: RegExpMatchArray,
  invocation: MacroInvocation<Origin>,
): MacroArgument<Origin> | undefined {
  const builtin = match[3]?.toUpperCase();
  if (builtin === "NARG" || match[1] === "#")
    return { text: String(invocation.arguments.length) };
  if (builtin === "CARG") return { text: String(invocation.carg) };

  const parameter = match[1];
  if (parameter === "@")
    return invocation.unique === undefined
      ? undefined
      : { text: invocation.unique };
  if (parameter === "0") return invocation.qualifier ?? { text: "" };
  if (parameter === "." || parameter === "+" || parameter === "-") {
    const argument = invocation.arguments[invocation.carg - 1] ?? { text: "" };
    if (parameter === "+") invocation.carg++;
    else if (parameter === "-") invocation.carg--;
    return argument;
  }

  const query = match[2];
  if (query) {
    const index = argumentIndex(query);
    return {
      text: String(
        index === undefined
          ? 0
          : (invocation.arguments[index]?.text.length ?? 0),
      ),
    };
  }
  const index = argumentIndex(parameter);
  if (index === undefined) return undefined;
  const given = invocation.arguments[index];
  if (given) return given;
  // An argument \1-\9 the call did not supply is empty, which is what IFB
  // tests for. A letter is only a parameter in some modes, and otherwise is
  // an escape such as the `\n` in a string, so it is left as written.
  return /^[1-9]$/.test(parameter) ? { text: "" } : undefined;
}

/**
 * Substitute a call's arguments into one line of a macro body.
 *
 * Handles `\0`-`\9`, `\a`-`\z`, `\?n`, `\#`, `\.`, `\+`, `\-`, `\@`, NARG and
 * CARG. A numbered parameter the call did not supply is empty, as in an
 * assembler; a lettered one is left as written.
 * Anything that is not a recognised parameter is left as written.
 */
export function substituteMacroParameters<Origin = unknown>(
  text: string,
  invocation: MacroInvocation<Origin>,
): ExpandedText<Origin> {
  let output = "";
  let cursor = 0;
  const spans: ExpansionSpan<Origin>[] = [];
  const pattern = /\\(\?([1-9a-z])|[0-9a-z#.+@-])|\b(NARG|CARG)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    output += text.slice(cursor, start);
    const replacement = substitution(match, invocation);
    const replacementStart = output.length;
    output += replacement?.text ?? match[0];
    if (replacement?.origin !== undefined)
      spans.push({
        start: replacementStart,
        end: output.length,
        origin: replacement.origin,
        literal: replacement.literal,
      });
    cursor = start + match[0].length;
  }
  output += text.slice(cursor);
  return { text: output, spans };
}

/** One line of an expanded macro, parsed. */
export interface ExpandedMacroLine<
  Origin = unknown,
> extends ExpandedText<Origin> {
  line: ParsedLine;
  /** What the parser objected to in the expanded text, if anything. */
  errors: ParseError[];
  /** How many macro calls deep this line is; 0 for the call being expanded. */
  depth: number;
  /**
   * The line is itself a call to a macro that was expanded in place. The lines
   * of that expansion follow it, so a caller that wants only the instructions
   * can skip this one.
   */
  expandedCall: boolean;
}

export interface MacroExpansion<Origin = unknown> {
  lines: ExpandedMacroLine<Origin>[];
  /**
   * Some of the expansion is missing: a macro called itself, nesting went too
   * deep, or the output grew past the limit. Treat what is there as partial.
   */
  incomplete: boolean;
}

export interface ExpandOptions<Origin = unknown> {
  /** Find a macro by name; undefined leaves a nested call unexpanded. */
  resolve(name: string): MacroDefinition | undefined;
  /** Origin for a nested argument whose text cannot be traced to a span. */
  fallbackOrigin?: Origin;
  /** Value for `\@`, called once per call, nested calls included. */
  unique?(): string;
  /** Deepest nesting followed. Defaults to 10. */
  maxDepth?: number;
  /** Most lines produced across the whole expansion. Defaults to 1000. */
  maxLines?: number;
}

interface State {
  incomplete: boolean;
  depth: number;
  remaining: number;
  stack: Set<MacroDefinition>;
}

/**
 * Expand one macro call, following calls it makes to other macros.
 *
 * Each expanded line is parsed. A line that is itself a call to a macro the
 * lookup can resolve is expanded in turn, with the arguments it passes on
 * traced back to where they were first written.
 */
export function expandMacro<Origin = unknown>(
  definition: MacroDefinition,
  invocation: MacroInvocation<Origin>,
  options: ExpandOptions<Origin>,
): MacroExpansion<Origin> {
  const state: State = {
    incomplete: false,
    depth: 0,
    remaining: options.maxLines ?? 1000,
    stack: new Set(),
  };
  const lines: ExpandedMacroLine<Origin>[] = [];
  run(definition, invocation, options, state, lines);
  return { lines, incomplete: state.incomplete };
}

function run<Origin>(
  definition: MacroDefinition,
  invocation: MacroInvocation<Origin>,
  options: ExpandOptions<Origin>,
  state: State,
  out: ExpandedMacroLine<Origin>[],
): void {
  if (
    state.depth >= (options.maxDepth ?? 10) ||
    state.remaining <= 0 ||
    state.stack.has(definition)
  ) {
    state.incomplete = true;
    return;
  }

  state.stack.add(definition);
  invocation.unique ??= options.unique?.();
  for (const bodyLine of definition.body) {
    if (state.remaining-- <= 0) {
      state.incomplete = true;
      break;
    }
    const expanded = substituteMacroParameters(bodyLine, invocation);
    const { value: line, errors } = parseLine(expanded.text);
    const nested =
      line.mnemonic?.type === "macro"
        ? options.resolve(line.mnemonic.macro)
        : undefined;
    out.push({
      ...expanded,
      line,
      errors,
      depth: state.depth,
      expandedCall: nested !== undefined,
    });

    if (nested) {
      const trace = (loc: Location): MacroArgument<Origin> => ({
        text: expanded.text.slice(loc.start, loc.end),
        literal: expanded.spans.some(
          (span) =>
            span.literal && span.start === loc.start && span.end === loc.end,
        ),
        origin:
          expanded.spans.find(
            (span) => loc.start < span.end && span.start < loc.end,
          )?.origin ?? options.fallbackOrigin,
      });
      state.depth++;
      run(
        nested,
        {
          arguments: (line.operands ?? []).map((operand) => trace(operand.loc)),
          qualifier: line.qualifier ? trace(line.qualifier.loc) : undefined,
          carg: 1,
        },
        options,
        state,
        out,
      );
      state.depth--;
    }
  }
  state.stack.delete(definition);
}
