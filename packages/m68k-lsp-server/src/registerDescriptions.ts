import type { RegisterAccess } from "@m68k-lsp/protocol";
import { isLocalLabelName } from "m68k-parser";
import type { ParsedLine } from "m68k-parser";
import type * as lsp from "vscode-languageserver";
import { type AstNode, descendants } from "./ast";
import { type Context } from "./context";
import { isProcessed } from "./DocumentProcessor";
import {
  analyzeRegisterUsage,
  canonicalGeneralPurposeRegister,
  createFlowGraph,
  findBlockRange,
  registerName,
} from "./registerAnalysis";
import {
  callTargetSymbol,
  isCallInstruction,
  precedingCommentLines,
  resolveDefinitionByName,
} from "./symbols";

/** A comment line that documents one or more registers. */
export interface RegisterComment {
  registers: string[];
  size?: string;
  description: string;
}

export interface RegisterHeaderEntry {
  input?: string;
  output?: string;
  trashed?: boolean;
}

export type RegisterDescriptionSource =
  /** The header of the current block's label documents it as an input. */
  | "header"
  /** A comment naming the register. */
  | "comment"
  /** A comment without a register name, on a line writing only this one. */
  | "inferred-comment"
  /** The source operand of the instruction that last wrote the register. */
  | "operand"
  /** The header of a called routine documents it as an output. */
  | "call";

export interface RegisterDescription {
  /** Prose description, or the lead-in to `code` for operand descriptions. */
  text: string;
  /** Source text to show as code, for operand descriptions. */
  code?: string;
  source: RegisterDescriptionSource;
  /** Zero-based line the description was taken from or assigned on. */
  line: number;
  /** Routine whose header supplied the description. */
  routine?: string;
}

export interface RegisterDescriptionResult {
  /** Meaning of the register at the requested position, if known. */
  current?: RegisterDescription;
  /** What the current block's header says it returns in the register. */
  output?: string;
  routine?: string;
}

const register = String.raw`(?:[da][0-7]|sp)`;
const registerList = String.raw`${register}(?:\s*[-/]\s*${register})*`;
// A range is only taken when another register follows the dash, so the dash
// in `d0 - frame count` falls through to the separator alternatives.
const registerCommentPattern = new RegExp(
  String.raw`^(${registerList})(?:\.([bwl]))?(?:\s*[=:]\s*|\s+-\s+|\s+)(\S.*?)\s*$`,
  "i",
);
const registerListPattern = new RegExp(String.raw`^${registerList}$`, "i");

type HeaderSection = "input" | "output" | "trashed";

const headingPatterns: [RegExp, HeaderSection][] = [
  [/^(?:inputs?|in|args?|arguments?|params?|parameters?|entry)$/i, "input"],
  [/^(?:outputs?|out|returns?|results?|exit)$/i, "output"],
  [
    /^(?:trash(?:es|ed)?|destroys|destroyed|clobbers|clobbered|corrupts|corrupted|scratch)$/i,
    "trashed",
  ],
];

/** Removes repeated prefixes and list bullets left in comment content. */
function commentText(text: string): string {
  return text.replace(/^[;*\s]+/, "").replace(/^[-•]\s+/, "");
}

/**
 * Parses a comment such as `d0 = frame count`, `D0: frame count`,
 * `d0 - frame count` or `d0-d2/a0 = angles` into the registers it documents.
 *
 * The text is the comment without its `;` or `*` prefix.
 */
export function parseRegisterComment(
  text: string,
): RegisterComment | undefined {
  const match = registerCommentPattern.exec(commentText(text));
  if (!match) {
    return;
  }
  const registers = expandRegisterList(match[1]);
  return registers.length
    ? {
        registers,
        ...(match[2] ? { size: match[2].toLowerCase() } : {}),
        description: match[3],
      }
    : undefined;
}

/** Registers named by text such as `d0-d2/a0`, `d0, d1` or `d0 d1`. */
function parseRegisterNames(text: string): string[] | undefined {
  const items = text
    .replace(/\s*([-/])\s*/g, "$1")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (!items.length || !items.every((item) => registerListPattern.test(item))) {
    return;
  }
  return items.flatMap(expandRegisterList);
}

function expandRegisterList(text: string): string[] {
  const registers: string[] = [];
  for (const group of text.split(/\s*\/\s*/)) {
    const [first, last] = group
      .split(/\s*-\s*/)
      .map((name) => canonicalGeneralPurposeRegister(name));
    if (!first) {
      continue;
    }
    if (last && last[0] === first[0] && last[1] >= first[1]) {
      for (let n = Number(first[1]); n <= Number(last[1]); n++) {
        registers.push(first[0] + n);
      }
    } else {
      registers.push(first, ...(last ? [last] : []));
    }
  }
  return [...new Set(registers)];
}

/**
 * Reads the registers documented in a routine header.
 *
 * `Inputs:`, `Outputs:` and `Trashes:` style headings start sections, and may
 * carry register text on the same line. Register lines before any heading are
 * taken as inputs, and other prose is ignored.
 */
export function parseRoutineHeader(
  lines: string[],
): Map<string, RegisterHeaderEntry> {
  const entries = new Map<string, RegisterHeaderEntry>();
  let section: HeaderSection = "input";
  for (const raw of lines) {
    let text = commentText(raw).trim();
    const heading = /^([a-z ]+?)\s*(?::\s*(.*))?$/i.exec(text);
    const matched = headingPatterns.find(([pattern]) =>
      pattern.test(heading?.[1].replace(/^on\s+/i, "") ?? ""),
    );
    if (matched && heading) {
      section = matched[1];
      text = heading[2] ?? "";
      if (!text) {
        continue;
      }
    }

    const comment = parseRegisterComment(text);
    const registers = comment?.registers ?? parseRegisterNames(text);
    for (const name of registers ?? []) {
      const entry = entries.get(name) ?? entries.set(name, {}).get(name)!;
      if (section === "trashed") {
        entry.trashed = true;
      } else if (comment) {
        entry[section] = comment.description;
      }
    }
  }
  return entries;
}

export interface RoutineHeader {
  /** Zero-based line of the block's label. */
  line: number;
  name: string;
  registers: Map<string, RegisterHeaderEntry>;
}

/**
 * Header of the block around a position: the comment lines directly above
 * its non-local label. Undefined when the block has no label.
 */
export function blockHeaderAt(
  ctx: Context,
  uri: string,
  position: lsp.Position,
): RoutineHeader | undefined {
  const document = ctx.store.get(uri);
  if (!isProcessed(document)) {
    return;
  }
  const block = findBlockRange(ctx, { textDocument: { uri }, position });
  if (!block) {
    return;
  }
  const { lines } = document.parsed;
  const line = block.range.start.line;
  const label = lines[line]?.label;
  if (!label || label.scope === "local") {
    return;
  }
  return {
    line,
    name: label.label,
    registers: parseRoutineHeader(
      precedingCommentLines(lines, line).map(
        (index) => lines[index].comment!.content,
      ),
    ),
  };
}

/**
 * Meaning of a general-purpose register at a position, from comments and
 * assignments earlier in its block.
 *
 * Lines are followed along the block's control flow from its label: a
 * description holds until a comment replaces it or an instruction overwrites
 * the register outright, and only where every path reaching a line agrees on
 * it. Read-modify-write instructions keep it.
 */
export function describeRegister(
  ctx: Context,
  uri: string,
  position: lsp.Position,
  name: string,
): RegisterDescriptionResult | undefined {
  const document = ctx.store.get(uri);
  const target = canonicalGeneralPurposeRegister(name);
  if (!isProcessed(document) || !target) {
    return;
  }
  const block = findBlockRange(ctx, { textDocument: { uri }, position });
  if (!block) {
    return;
  }

  const { lines } = document.parsed;
  const lineTexts = document.document.getText().split(/\r?\n/g);
  const startLine = block.range.start.line;
  const routineHeader = blockHeaderAt(ctx, uri, position);
  const routineName = routineHeader?.name;
  const header = routineHeader?.registers.get(target);

  const accessesByLine = new Map<number, Map<string, Set<RegisterAccess>>>();
  const usage = analyzeRegisterUsage(ctx, {
    textDocument: { uri },
    range: block.range,
  });
  for (const { name: used, references } of usage?.registers ?? []) {
    for (const { range, access } of references) {
      const line = range.start.line;
      const registers =
        accessesByLine.get(line) ??
        accessesByLine.set(line, new Map()).get(line)!;
      (registers.get(used) ?? registers.set(used, new Set()).get(used)!).add(
        access,
      );
    }
  }

  const entry: RegisterDescription | undefined = header?.input
    ? {
        text: header.input,
        source: "header",
        line: startLine,
        routine: routineName,
      }
    : undefined;

  /** The description after a line, given the one before it. */
  const transfer = (
    index: number,
    before: RegisterDescription | undefined,
  ): RegisterDescription | undefined => {
    const line = lines[index];
    const comment = line.comment?.content.trim();
    const documented = comment ? parseRegisterComment(comment) : undefined;
    if (documented?.registers.includes(target)) {
      return { text: documented.description, source: "comment", line: index };
    }

    const accesses = accessesByLine.get(index);
    if (accesses?.get(target)?.has("write")) {
      const written = [...accesses].filter(([, access]) => access.has("write"));
      return comment && !documented && written.length === 1
        ? { text: comment, source: "inferred-comment", line: index }
        : operandDescription(line, lineTexts[index] ?? "", index, target);
    }

    if (isCallInstruction(line)) {
      const callee = callTargetSymbol(line.operands as AstNode[] | undefined);
      if (!callee || isLocalLabelName(callee.name)) {
        return before;
      }
      const definition = resolveDefinitionByName(uri, callee.name, ctx);
      const calleeEntry = definition?.header
        ? parseRoutineHeader(definition.header).get(target)
        : undefined;
      if (calleeEntry?.output) {
        return {
          text: calleeEntry.output,
          source: "call",
          line: index,
          routine: definition!.name,
        };
      }
      if (calleeEntry?.trashed) {
        return undefined;
      }
    }
    return before;
  };

  // Forward over the block's flow: the description on entry to a line is
  // the one every path reaching it agrees on, so one set in one branch does
  // not carry past where the branches join. Code with no way in from the
  // block's flow starts with no description.
  const nodeAt = createFlowGraph(
    document.parsed,
    document.blocks,
    ctx,
    uri,
    lineTexts,
  );
  const endLine = Math.min(block.range.end.line, lines.length - 1);
  const predecessors = new Map<number, number[]>();
  for (let index = startLine; index <= endLine; index++) {
    for (const next of nodeAt(index).next) {
      if (next >= startLine && next <= endLine) {
        (predecessors.get(next) ?? predecessors.set(next, []).get(next)!).push(
          index,
        );
      }
    }
  }
  const after = new Map<number, RegisterDescription | undefined>();
  for (let changed = true; changed;) {
    changed = false;
    for (let index = startLine; index <= endLine; index++) {
      const incoming = predecessors.get(index) ?? [];
      const reached = incoming.filter((line) => after.has(line));
      const candidates =
        index === startLine || !incoming.length
          ? [index === startLine ? entry : undefined]
          : [];
      candidates.push(...reached.map((line) => after.get(line)));
      if (!candidates.length) {
        continue;
      }
      const before = candidates.every((candidate) =>
        sameMeaning(candidate, candidates[0]),
      )
        ? candidates[0]
        : undefined;
      const description = transfer(index, before);
      if (
        !after.has(index) ||
        !sameDescription(after.get(index), description)
      ) {
        after.set(index, description);
        changed = true;
      }
    }
  }
  const current = after.has(position.line)
    ? after.get(position.line)
    : transfer(position.line, undefined);

  const output = header?.output;
  if (!current && !output) {
    return;
  }
  return {
    ...(current ? { current } : {}),
    ...(output ? { output } : {}),
    ...(routineName ? { routine: routineName } : {}),
  };
}

/**
 * Describes a register by the symbolic source an instruction assigns it from,
 * such as `lea SomeTable,a0`. Plain numbers carry no meaning worth showing.
 */
function operandDescription(
  line: ParsedLine,
  lineText: string,
  index: number,
  target: string,
): RegisterDescription | undefined {
  const operands = (line.operands ?? []) as AstNode[];
  if (line.mnemonic?.type !== "instruction" || operands.length !== 2) {
    return;
  }
  const [source, destination] = operands;
  if (canonicalGeneralPurposeRegister(registerName(destination)) !== target) {
    return;
  }
  if (![source, ...descendants(source)].some(({ type }) => type === "symbol")) {
    return;
  }
  const code = lineText.slice(source.loc.start, source.loc.end);
  const text =
    line.mnemonic.instruction.toLowerCase() === "lea"
      ? "address of"
      : source.type === "immediate"
        ? ""
        : "loaded from";
  return { text, code, source: "operand", line: index };
}

function sameDescription(
  a: RegisterDescription | undefined,
  b: RegisterDescription | undefined,
): boolean {
  return (
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      a.text === b.text &&
      a.code === b.code &&
      a.source === b.source &&
      a.line === b.line &&
      a.routine === b.routine)
  );
}

/** Whether two descriptions say the same, wherever they came from. */
function sameMeaning(
  a: RegisterDescription | undefined,
  b: RegisterDescription | undefined,
): boolean {
  return (
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      a.text === b.text &&
      a.code === b.code)
  );
}
