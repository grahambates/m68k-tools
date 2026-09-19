import { parseFile } from "m68k-parser";
import type { ExpressionNode, ParsedFile, ParsedLine } from "m68k-parser";
import {
  evaluateConstant,
  type ConstantResult,
} from "../analysis/constants.js";
import {
  DefaultSymbolTable,
  type ExternalSymbols,
  type ExternalUse,
  type SymbolTable,
} from "../analysis/symbols.js";
import { analyzeFlags, type FlagAnalysis } from "../analysis/flags.js";
import { prepareMacros } from "../analysis/macros.js";
import {
  nameKey,
  setCaseSensitive,
  setEscapeSequences,
} from "../analysis/case-mode.js";
import {
  conditionalAssembly,
  prepareConditionals,
} from "../analysis/conditionals.js";
import {
  analyzeRegisters,
  type RegisterAnalysis,
} from "../analysis/registers.js";
import type { LintConfig } from "./config.js";
import type { FileFacts } from "./facts.js";
import type { Diagnostic } from "./diagnostic.js";
import { isMacroInvocation } from "../util/ast.js";
import { computeSourceSpan, type SourceSpan } from "./span.js";
import { isBlockBoundary } from "../analysis/blocks.js";
import { collectReferencedSymbols } from "../analysis/references.js";
import type { ProjectReferences } from "../analysis/project-references.js";

export interface RuleContext {
  readonly file: ParsedFile;
  readonly source: string;
  readonly config: LintConfig;
  readonly symbols: SymbolTable;
  readonly flags: FlagAnalysis;
  readonly registers: RegisterAnalysis;
  /**
   * Whether any name appears anywhere in the project, for rules that need to
   * know a symbol is unused rather than what it resolves to. Undefined where
   * no project-wide index was built -- a single file linted in isolation, or
   * project indexing turned off -- since "unused in the one file I can see" is
   * not evidence for a name that may be called from elsewhere.
   */
  readonly projectReferences?: ProjectReferences;
  /** What the file system says about this file, where the caller supplied it. */
  readonly facts?: FileFacts;
  /**
   * The key a symbol name is compared by: the name itself, or lower-cased where
   * the project folds case. Compare labels, constants and macros through this,
   * never by lower-casing a name directly.
   */
  nameKey(name: string): string;

  report(diagnostic: Diagnostic): void;
  evaluate(expr: ExpressionNode): ConstantResult;
  line(index: number): ParsedLine | undefined;
  sourceLine(index: number): string | undefined;
  /** The exact source text of a parsed node, so replacements can keep what the author wrote. */
  sourceTextOf(
    node: { loc?: { line?: number; start: number; end: number } } | undefined,
  ): string | undefined;
  previousInstruction(
    index: number,
  ): { line: ParsedLine; index: number } | undefined;
  nextInstruction(
    index: number,
  ): { line: ParsedLine; index: number } | undefined;
}

/**
 * Name any constant the diagnostic depended on that came from another file.
 *
 * A value taken from a header the linter merely found, rather than one this
 * file states, is the likeliest thing to be wrong about a report. Saying where
 * it came from turns a confident and otherwise inexplicable diagnostic into one
 * the reader can check.
 */
function withProvenance(
  diagnostic: Diagnostic,
  used: readonly ExternalUse[],
): Diagnostic["notes"] {
  if (used.length === 0) return diagnostic.notes;
  const listed = used
    .map(({ name, value, origin }) => `${name} = ${value} (from ${origin})`)
    .join(", ");
  return [
    ...(diagnostic.notes ?? []),
    { message: `Resolved from outside this file: ${listed}.` },
  ];
}

/**
 * The indentation an instruction on this line sits at.
 *
 * Usually the leading whitespace. Where a label occupies column zero, the gap
 * between the label and the mnemonic is the instruction's own indentation, and
 * is what a replacement should adopt.
 */
function indentOf(sourceLine: string | undefined): string {
  if (sourceLine === undefined) return "\t";
  const leading = /^[ \t]+/.exec(sourceLine)?.[0];
  if (leading) return leading;
  return /^\S+([ \t]+)(?=\S)/.exec(sourceLine)?.[1] ?? "\t";
}

/** Indent every line that does not carry its own indentation already. */
function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.trim().length === 0 || /^[ \t]/.test(line)
        ? line
        : `${indent}${line}`,
    )
    .join("\n");
}

/**
 * Assumed width of a tab when working out which column something sits in.
 *
 * Only used to count tab stops. Where the source aligns with tabs the
 * replacement is padded with tabs too, so both land on the same stop and the
 * columns agree however wide the reader's tabs actually are.
 */
const TAB_WIDTH = 8;

function columnOf(text: string): number {
  let column = 0;
  for (const char of text)
    column =
      char === "\t"
        ? (Math.floor(column / TAB_WIDTH) + 1) * TAB_WIDTH
        : column + 1;
  return column;
}

/** How the operands on a line are separated from the mnemonic, and where they start. */
interface OperandAlignment {
  column: number;
  tabs: boolean;
}

/**
 * Where the operands sit on the line a diagnostic points at.
 *
 * Matching the indent alone still leaves a replacement's operands out of line
 * with its neighbours, because rules emit a single space where source almost
 * always uses a tab. Taken from the parsed line rather than by scanning text,
 * so a label or a size qualifier does not confuse the mnemonic's extent.
 */
function operandAlignmentOf(
  line: ParsedLine | undefined,
  sourceLine: string | undefined,
): OperandAlignment | undefined {
  const operandStart = line?.operands?.[0]?.loc.start;
  const mnemonicEnd = line?.qualifier?.loc.end ?? line?.mnemonic?.loc.end;
  if (
    sourceLine === undefined ||
    operandStart === undefined ||
    mnemonicEnd === undefined
  )
    return undefined;
  if (operandStart <= mnemonicEnd) return undefined;

  const separator = sourceLine.slice(mnemonicEnd, operandStart);
  if (separator.trim().length > 0) return undefined;
  // A single space is a separator, not an alignment. Matching a column there
  // would pad a shorter mnemonic out to it and produce `moveq  #100,d0` from
  // source that never lined anything up.
  if (separator === " ") return undefined;
  return {
    column: columnOf(sourceLine.slice(0, operandStart)),
    tabs: separator.includes("\t"),
  };
}

/**
 * Pad each line of a replacement so its operands begin in the same column as
 * the operands of the code being replaced.
 *
 * Replacements are generated, so a line is a mnemonic and its operands with
 * nothing else on it; splitting on the first run of whitespace is enough and
 * avoids parsing text this module produced itself.
 */
function alignOperands(text: string, alignment: OperandAlignment): string {
  return text
    .split("\n")
    .map((line) => {
      const parts = /^([ \t]*)(\S+)([ \t]+)(\S.*)$/.exec(line);
      if (!parts) return line;
      const [, indent, mnemonic, , operands] = parts;
      const from = columnOf(`${indent}${mnemonic}`);

      let separator = "";
      if (alignment.tabs) {
        // Tabs only land on stops, so this reaches the source's column exactly
        // when that column is one, and otherwise the first stop past it.
        for (
          let column = from;
          column < alignment.column;
          column = columnOf(`${" ".repeat(column)}\t`)
        ) {
          separator += "\t";
        }
      } else {
        separator = " ".repeat(Math.max(0, alignment.column - from));
      }
      return `${indent}${mnemonic}${separator || (alignment.tabs ? "\t" : " ")}${operands}`;
    })
    .join("\n");
}

/**
 * Names the replacement works out rather than carries.
 *
 * Where a rule copies a value through, the symbol survives and the code still
 * tracks the constant. Where it derives one -- a shift count from a multiplier,
 * the sum of two ADDQs -- the name disappears and only the arithmetic remains:
 * `muls.w #SCALE,d0` becomes `asl.l #3,d0`, which is silently wrong if SCALE
 * ever changes. That is invisible in a way a longer replacement is not, so it
 * is worth saying out loud.
 *
 * A replacement that deletes the code drops every name by design and is not
 * reported.
 */
function symbolsLostBy(
  original: readonly ParsedLine[],
  replacement: string,
): string[] {
  if (!replacement.trim()) return [];
  const before = collectReferencedSymbols(original);
  if (before.size === 0) return [];

  let after: Set<string>;
  try {
    after = collectReferencedSymbols(parseFile(replacement).lines);
  } catch {
    return [];
  }
  return [...before].filter((name) => !after.has(name));
}

/**
 * The text before the instruction on a line that carries a label, such as
 * `start:` and the whitespace after it. Only a label sharing the line matters:
 * one on its own line sits outside the span and is never touched.
 */
function labelPrefixOf(
  line: ParsedLine | undefined,
  sourceLine: string | undefined,
): string | undefined {
  if (!line?.label || sourceLine === undefined) return undefined;
  const start = line.mnemonic?.loc.start;
  if (start === undefined || start <= 0) return undefined;
  const prefix = sourceLine.slice(0, start);
  return prefix.trim() ? prefix : undefined;
}

/** Put the label back on the first line of the replacement, or on its own if nothing is left. */
function attachLabel(replacement: string, label: string): string {
  if (!replacement.trim()) return label.trimEnd();
  const lines = replacement.split("\n");
  lines[0] = `${label}${lines[0].replace(/^[ \t]+/, "")}`;
  return lines.join("\n");
}

/**
 * A line's trailing comment together with the whitespace leading up to it, so
 * `move.l #100,d0\t; how many faces` yields `\t; how many faces`.
 *
 * The original spacing is kept rather than normalised: it is what the author
 * chose, and where a replacement is the same width as what it replaces the
 * comment stays in its column.
 */
function trailingCommentOf(
  line: ParsedLine | undefined,
  sourceLine: string | undefined,
): string | undefined {
  const start = line?.comment?.loc.start;
  if (start === undefined || sourceLine === undefined) return undefined;
  const gap = /[ \t]*$/.exec(sourceLine.slice(0, start))?.[0] ?? "";
  const text = sourceLine.slice(start).trimEnd();
  return text ? `${gap}${text}` : undefined;
}

/**
 * Put the comments back.
 *
 * The first matched line's comment describes the operation being replaced, so
 * it goes on the first line of the replacement whether that is one instruction
 * or five. Comments further into a collapsing match have no line left to sit
 * on; they are kept on their own rather than dropped, since a comment is
 * usually the only record of why the code is the way it is.
 */
function attachComments(
  replacement: string,
  first: string | undefined,
  rest: readonly string[],
  indent: string,
): string {
  // An orphaned comment takes the indentation of the code it sat beside. A
  // comment is legal in column zero, but putting it there beside indented
  // instructions makes it read as a banner rather than an aside.
  const orphan = (comment: string) => `${indent}${comment.trimStart()}`;

  let lines = replacement.split("\n");
  if (first && replacement.trim()) lines[0] = `${lines[0]}${first}`;
  else if (first) lines = [orphan(first)];
  return [...lines, ...rest.map(orphan)].join("\n");
}

export class DefaultRuleContext implements RuleContext {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly sourceLines: string[];
  /** Rebuilt while conditional assembly is settled; fixed once construction ends. */
  public symbols: SymbolTable;
  public readonly flags: FlagAnalysis;
  public readonly registers: RegisterAnalysis;

  constructor(
    public readonly file: ParsedFile,
    public readonly source: string,
    public readonly config: LintConfig,
    external?: ExternalSymbols,
    public readonly projectReferences?: ProjectReferences,
    public readonly facts?: FileFacts,
  ) {
    this.sourceLines = source.split(/\r?\n/);
    // Before anything looks a name up: the symbol table and every analysis read it.
    setCaseSensitive(file, config.caseSensitive ?? true);
    setEscapeSequences(file, config.escapeSequences ?? false);
    this.symbols = new DefaultSymbolTable(file, external);
    this.settleConditionals(file, external);
    // Before the analyses, which read what each macro call expands to.
    prepareMacros(file, source, external, (expr) => {
      const result = this.evaluate(expr);
      return result.known ? result.value : undefined;
    });
    this.flags = analyzeFlags(file);
    this.registers = analyzeRegisters(file, (name) => {
      const result = this.symbols.evaluate(name);
      return result.known ? result.value : undefined;
    });
  }

  /**
   * Leave out the arms of conditional assembly that are not assembled.
   *
   * A constant defined only inside an arm can decide a later condition, and
   * dropping an arm can make a constant unambiguous, so this repeats until
   * nothing changes, which a few rounds always reaches in practice.
   */
  private settleConditionals(
    file: ParsedFile,
    external: ExternalSymbols | undefined,
  ): void {
    const value = (expr: ExpressionNode) => {
      const result = this.evaluate(expr);
      return result.known ? result.value : undefined;
    };
    const signature = () =>
      conditionalAssembly(file)
        .unassembled.map((left) => (left ? "1" : "0"))
        .join("");

    let last = "";
    for (let round = 0; round < 4; round++) {
      prepareConditionals(file, value, this.sourceLines);
      const now = signature();
      if (now === last || !now.includes("1")) break;
      last = now;
      const { unassembled } = conditionalAssembly(file);
      this.symbols = new DefaultSymbolTable(
        file,
        external,
        (index) => unassembled[index],
      );
    }
  }

  nameKey(name: string): string {
    return nameKey(this.file, name);
  }

  report(diagnostic: Diagnostic): void {
    const span = computeSourceSpan(diagnostic, this.file);
    const suggestion = this.placeSuggestion(diagnostic, span);
    const replacement =
      suggestion?.replacement ?? diagnostic.suggestion?.replacement;
    const lost =
      span && replacement !== undefined
        ? symbolsLostBy(
            this.file.lines.slice(span.startLine - 1, span.endLine),
            replacement,
          )
        : [];

    let notes = withProvenance(diagnostic, this.symbols.externalUses());
    if (lost.length) {
      const names = lost.map((name) => name.toUpperCase()).join(", ");
      notes = [
        ...(notes ?? []),
        {
          message: `${names} ${lost.length === 1 ? "does" : "do"} not appear in the replacement: its value has been worked out here, so the code will no longer follow a change to ${lost.length === 1 ? "it" : "them"}.`,
        },
      ];
    }
    // Also recorded rather than only described, so anything acting on the
    // suggestion can see it without reading the prose back.
    const data = lost.length
      ? { ...(diagnostic.data ?? {}), symbolsLost: lost }
      : diagnostic.data;
    let highlight = diagnostic.highlight;
    if (!highlight && span && diagnostic.category === "optimization") {
      const first = this.file.lines[span.startLine - 1];
      const last = this.file.lines[span.endLine - 1];
      const mnemonic = first?.mnemonic?.loc;
      if (
        mnemonic &&
        last &&
        (span.startLine !== span.endLine ||
          (diagnostic.loc.start === mnemonic.start &&
            diagnostic.loc.end === mnemonic.end))
      ) {
        const end = last.operands?.at(-1)?.loc ?? last.mnemonic?.loc;
        if (end) highlight = { start: mnemonic, end };
        // A one-instruction replacement can identify a more precise display
        // range. Compare parsed tokens, leaving edit spans and rule locations
        // unchanged. Multi-instruction rewrites retain their full extent.
        if (span.startLine === span.endLine && replacement?.trim()) {
          const replacements = parseFile(replacement).lines.filter(
            (line) => line.mnemonic,
          );
          const next = replacements.length === 1 ? replacements[0] : undefined;
          if (next?.mnemonic && first?.mnemonic) {
            const originalText = this.sourceLines[span.startLine - 1];
            const replacementText =
              replacement.split("\n")[(next.mnemonic.loc.line ?? 1) - 1];
            const token = (text: string, loc: { start: number; end: number }) =>
              text.slice(loc.start, loc.end).toLowerCase();
            const operands = first.operands ?? [];
            const nextOperands = next.operands ?? [];
            const sameMnemonic =
              token(originalText, mnemonic) ===
              token(replacementText, next.mnemonic.loc);
            const sameQualifier =
              (first.qualifier
                ? token(originalText, first.qualifier.loc)
                : "") ===
              (next.qualifier
                ? token(replacementText, next.qualifier.loc)
                : "");
            if (operands.length === nextOperands.length && sameQualifier) {
              const changed = operands.filter(
                (operand, index) =>
                  token(originalText, operand.loc) !==
                  token(replacementText, nextOperands[index].loc),
              );
              if (sameMnemonic && changed.length === 1)
                highlight = { start: changed[0].loc, end: changed[0].loc };
              else if (!sameMnemonic && changed.length === 0)
                highlight = { start: mnemonic, end: mnemonic };
            }
          }
        }
      }
    }
    this.diagnostics.push({
      ...diagnostic,
      ...(highlight ? { highlight } : {}),
      notes,
      span,
      data,
      ...(suggestion ? { suggestion } : {}),
    });
  }

  /**
   * Give a replacement the indentation of the code it replaces.
   *
   * Rules emit compact text starting in column zero, which is not valid
   * assembly: a token in column zero is a label, so a two-line replacement
   * pasted as-is defines two labels and assembles nothing like the intent. The
   * indentation comes from the line the diagnostic is on, so a replacement
   * lands in the column its neighbours use.
   */
  /**
   * Lay a replacement out where it is going, and refuse where it cannot go.
   *
   * A replacement stands in for whole lines, so anything on them that is not
   * the instruction is destroyed by applying it. A label is the case that
   * matters: dropping one does not merely lose information, it breaks every
   * branch to it. `start: move.l #100,d0` becoming `moveq #100,d0` was a
   * `safe` suggestion that would have deleted `start:`.
   *
   * A label on the first line still points at the same instruction afterwards,
   * so it is carried across. A label further into the run has nowhere to go
   * once the run collapses -- three lines becoming one leaves no line for a
   * label that pointed at the second -- so there is no rewrite to offer and the
   * finding becomes a manual one. Done here rather than in each rule so that no
   * rule can forget.
   */
  private placeSuggestion(
    diagnostic: Diagnostic,
    span: SourceSpan | undefined,
  ): Diagnostic["suggestion"] {
    const suggestion = diagnostic.suggestion;
    if (!suggestion || suggestion.replacement === undefined || !span)
      return undefined;

    const matched = this.file.lines.slice(span.startLine - 1, span.endLine);
    // A directive inside the match is structure, not code to be rewritten.
    // Replacing the run would delete an ENDC or an alignment and the file would
    // stop assembling, so there is no rewrite to offer. Rules should not match
    // across one in the first place; this is the backstop for any that build a
    // span some other way.
    //
    // The exception is one line rewritten as the same directive, such as an
    // INCLUDE with a corrected path: nothing structural is removed, only an
    // operand changes. A block boundary is never let through.
    const only = matched.length === 1 ? matched[0] : undefined;
    const rewritesInPlace =
      only?.mnemonic?.type === "directive" &&
      !isBlockBoundary(only) &&
      (() => {
        try {
          // Indented, as it will be once placed: in column zero a directive
          // would be read as a label.
          const rewritten = parseFile(
            `\t${suggestion.replacement.trimStart()}`,
          ).lines.find((line) => line.mnemonic)?.mnemonic;
          return (
            rewritten?.type === "directive" &&
            rewritten.directive.toLowerCase() ===
              only.mnemonic?.directive?.toLowerCase()
          );
        } catch {
          return false;
        }
      })();
    if (
      !rewritesInPlace &&
      matched.some(
        (line) => isBlockBoundary(line) || line?.mnemonic?.type === "directive",
      )
    ) {
      return { ...suggestion, replacement: undefined, applicability: "manual" };
    }
    if (matched.slice(1).some((line) => line?.label)) {
      return { ...suggestion, replacement: undefined, applicability: "manual" };
    }

    const first = this.file.lines[span.startLine - 1];
    const sourceLine = this.sourceLines[span.startLine - 1];
    let replacement = suggestion.replacement;
    if (replacement) {
      replacement = indentBlock(replacement, indentOf(sourceLine));
      const alignment = operandAlignmentOf(first, sourceLine);
      if (alignment) replacement = alignOperands(replacement, alignment);
    }

    const label = labelPrefixOf(first, sourceLine);
    if (label) replacement = attachLabel(replacement, label);

    // Everything on the matched lines that is not the instruction has to be put
    // back, or applying the replacement quietly throws it away.
    const firstComment = trailingCommentOf(first, sourceLine);
    const laterComments = matched
      .slice(1)
      .map((line, offset) =>
        trailingCommentOf(line, this.sourceLines[span.startLine + offset]),
      )
      .filter((comment): comment is string => comment !== undefined);
    if (firstComment || laterComments.length) {
      replacement = attachComments(
        replacement,
        firstComment,
        laterComments,
        indentOf(sourceLine),
      );
    }

    return { ...suggestion, replacement };
  }

  /** Drop the record of constants borrowed from other files. Called per line. */
  forgetExternalUses(): void {
    this.symbols.forgetExternalUses();
  }

  evaluate(expr: ExpressionNode): ConstantResult {
    return evaluateConstant(expr, (name) => {
      const result = this.symbols.evaluate(name);
      return result.known ? result.value : undefined;
    });
  }

  line(index: number): ParsedLine | undefined {
    return this.file.lines[index];
  }

  sourceLine(index: number): string | undefined {
    return this.sourceLines[index];
  }

  /**
   * The source text a node was parsed from.
   *
   * Rules that pass a value straight through use this instead of the number it
   * evaluates to, so a replacement for `adda.w #SCREEN_BW/2,a3` reads
   * `lea SCREEN_BW/2(a3),a3` rather than `lea 160(a3),a3`. Substituting the
   * number is a correct instruction and a bad edit: it discards the name that
   * says what the value means, and freezes a number that was meant to follow
   * the constant when it changes.
   */
  sourceTextOf(
    node: { loc?: { line?: number; start: number; end: number } } | undefined,
  ): string | undefined {
    const loc = node?.loc;
    if (!loc || loc.line === undefined) return undefined;
    const text = this.sourceLines[loc.line - 1]
      ?.slice(loc.start, loc.end)
      .trim();
    return text ? text : undefined;
  }

  /**
   * The adjacent instruction, or nothing if a macro invocation or a block
   * boundary comes first.
   *
   * Sequence rules use these to match a run of instructions and then offer a
   * replacement spanning it. A macro invocation between two of them is code
   * that would be deleted by such a replacement, so it has to end the search
   * rather than be stepped over: `prefer-link-sequence` was collapsing a frame
   * setup around an intervening macro call and dropping it.
   *
   * A block directive ends the search for the same reason and a stronger one.
   * `bsr Foo` inside an IFNE arm and an RTS after the ENDC are not a sequence a
   * replacement can stand in for -- collapsing them deletes the ENDC and the
   * file stops assembling -- and if the RTS is in the ELSE arm instead, the two
   * never even run together.
   */
  previousInstruction(
    index: number,
  ): { line: ParsedLine; index: number } | undefined {
    for (let i = index - 1; i >= 0; i--) {
      const line = this.file.lines[i];
      if (isMacroInvocation(line) || isBlockBoundary(line)) return undefined;
      if (line?.mnemonic?.type === "instruction") return { line, index: i };
    }
    return undefined;
  }

  nextInstruction(
    index: number,
  ): { line: ParsedLine; index: number } | undefined {
    for (let i = index + 1; i < this.file.lines.length; i++) {
      const line = this.file.lines[i];
      if (isMacroInvocation(line) || isBlockBoundary(line)) return undefined;
      if (line?.mnemonic?.type === "instruction") return { line, index: i };
    }
    return undefined;
  }

  getDiagnostics(): readonly Diagnostic[] {
    return this.diagnostics;
  }
}
