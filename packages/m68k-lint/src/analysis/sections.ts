import {
  collectMacroDefinitions,
  isLocalLabelName,
  type OperandNode,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";
import { directiveName, scanBlocks, type ConditionalBlock } from "./blocks.js";
import { conditionalAssembly } from "./conditionals.js";
import { analyzeLocalLabelScopes } from "./local-label-scopes.js";
import { nameKey } from "./assembler-mode.js";
import { expansionOf } from "../semantics/macro-expansions.js";

export type SectionKind = "code" | "data" | "bss";

export interface Section {
  /** Identity: two sections are the same section exactly when their keys match. */
  key: string;
  kind: SectionKind;
  /** How the source names it, for messages. */
  label: string;
  /** Memory the loader must use, or undefined for whatever it finds (fast first). */
  memory?: "chip" | "fast";
}

export interface SectionAnalysis {
  /** The section each line is assembled into, or undefined where that is not known. */
  at(index: number): Section | undefined;
  /**
   * The section of the address label a name refers to from a line, or
   * undefined where this file does not define one in a known section.
   */
  ofLabel(index: number, name: string): Section | undefined;
  /** The lines of the directives that open or reopen a section, in order. */
  directivesOf(section: Section): readonly number[];
}

/**
 * Which section each line and label belongs to, as vasm assigns them.
 *
 * vasm identifies a section by its name, its type and its memory attribute,
 * with the name compared exactly: `section a,code` and `section a,data` are
 * two sections, as are `a` and `A`. The shorthand directives name fixed
 * sections, so `code`, `text` and `section .text,code` are all one, and code
 * before any section directive goes to that same `.text`.
 *
 * Deliberately conservative. Anything that can move to a section this file
 * does not show makes the section unknown until the next section directive:
 * an INCLUDE, a macro call not known to stay put, ORG or OFFSET (whose labels
 * are absolute rather than in any section), a section name or attribute that
 * cannot be read, and an undecided conditional whose arms end in different
 * sections.
 */
export function analyzeSections(file: ParsedFile): SectionAnalysis {
  const blocks = scanBlocks(file);
  const assembly = conditionalAssembly(file);
  const scopes = analyzeLocalLabelScopes(file);
  const neutral = sectionNeutralMacros(file);
  const labelKey = (index: number, name: string) =>
    isLocalLabelName(name) ? scopes.keyOf(index, name) : nameKey(file, name);

  const opening = new Map<number, ConditionalBlock>();
  const arms = new Map<number, ConditionalBlock>();
  const closing = new Map<number, ConditionalBlock>();
  for (const block of blocks.conditionals) {
    opening.set(block.start, block);
    for (const alternative of block.alternatives) arms.set(alternative, block);
    closing.set(block.end, block);
  }
  const pending = new Map<
    ConditionalBlock,
    { entry: Section | undefined; exits: (Section | undefined)[] }
  >();

  const at: (Section | undefined)[] = [];
  const labels = new Map<string, Section | null>();
  const stack: (Section | undefined)[] = [];
  const directives = new Map<string, number[]>();
  const open = (section: Section | undefined, index: number) => {
    current = section;
    if (section)
      directives.set(section.key, [
        ...(directives.get(section.key) ?? []),
        index,
      ]);
  };
  let current: Section | undefined = DEFAULT_SECTION;

  file.lines.forEach((line, index) => {
    // A macro body is assembled wherever it is invoked, not here.
    if (blocks.region[index] !== 0 || assembly.unassembled[index]) return;
    at[index] = current;

    if (line.label && definesAddress(line)) {
      const key = labelKey(index, line.label.label);
      const known = labels.get(key);
      if (known === undefined) labels.set(key, current ?? null);
      else if (known?.key !== current?.key) labels.set(key, null);
    }

    const mnemonic = line.mnemonic;
    if (mnemonic?.type === "macro") {
      if (!expansionOf(line) && !neutral.has(nameKey(file, mnemonic.macro)))
        current = undefined;
      return;
    }
    if (mnemonic?.type !== "directive") return;
    const directive = mnemonic.directive.toLowerCase();

    // Each arm of an undecided conditional starts where the block did, and
    // the section after it is known only if every arm ends in the same one.
    if (!assembly.decided[index]) {
      const block = opening.get(index);
      if (block) {
        pending.set(block, { entry: current, exits: [] });
        return;
      }
      const arm = arms.get(index) ?? closing.get(index);
      const state = arm && pending.get(arm);
      if (arm && state) {
        state.exits.push(current);
        if (closing.has(index)) {
          const hasElse = arm.alternatives.some(
            (i) => directiveName(file.lines[i]) === "else",
          );
          if (!hasElse) state.exits.push(state.entry);
          const [first, ...rest] = state.exits;
          current = rest.every((s) => s?.key === first?.key)
            ? first
            : undefined;
          pending.delete(arm);
        } else {
          current = state.entry;
        }
        return;
      }
    }

    switch (directive) {
      case "section":
        open(namedSection(line.operands ?? []), index);
        return;
      case "pushsection":
        stack.push(current);
        return;
      case "popsection":
        current = stack.pop();
        return;
      case "org":
      case "offset":
      case "include":
        current = undefined;
        return;
    }
    const shorthand = SHORTHANDS[directive];
    if (shorthand) open(shorthand, index);
  });

  return {
    at: (index) => at[index],
    ofLabel: (index, name) => labels.get(labelKey(index, name)) ?? undefined,
    directivesOf: (section) => directives.get(section.key) ?? [],
  };
}

const DEFAULT_SECTION: Section = {
  key: ".text\0code",
  kind: "code",
  label: "code",
};

function section(
  name: string,
  kind: SectionKind,
  memory: "chip" | "fast" | undefined,
  label: string,
): Section {
  const id = memory ? `${name}.MEMF_${memory.toUpperCase()}` : name;
  return { key: `${id}\0${kind}`, kind, label, ...(memory ? { memory } : {}) };
}

/** Section types as vasm reads them, with their memory suffixes. */
function sectionType(
  name: string,
): { kind: SectionKind; memory?: "chip" | "fast" } | undefined {
  const match = /^(code|text|data|bss)(?:_([cfp]))?$/.exec(name.toLowerCase());
  if (!match) return undefined;
  const kind = match[1] === "text" ? "code" : (match[1] as SectionKind);
  const memory =
    match[2] === "c" ? "chip" : match[2] === "f" ? "fast" : undefined;
  return { kind, memory };
}

/** Bare directives naming a fixed section, with the names vasm gives them. */
const SHORTHANDS: Record<string, Section> = {
  code: DEFAULT_SECTION,
  text: DEFAULT_SECTION,
  cseg: DEFAULT_SECTION,
  data: section(".data", "data", undefined, "data"),
  dseg: section(".data", "data", undefined, "data"),
  bss: section(".bss", "bss", undefined, "bss"),
  code_c: section("code", "code", "chip", "code_c"),
  code_f: section("code", "code", "fast", "code_f"),
  data_c: section("data", "data", "chip", "data_c"),
  data_f: section("data", "data", "fast", "data_f"),
  bss_c: section("bss", "bss", "chip", "bss_c"),
  bss_f: section("bss", "bss", "fast", "bss_f"),
};

/** `section name[,type[,memory]]`, or undefined if any part cannot be read. */
function namedSection(operands: readonly OperandNode[]): Section | undefined {
  const [nameOp, typeOp, memoryOp, ...extra] = operands;
  if (extra.length) return undefined;
  const name =
    nameOp?.type === "value" && nameOp.value.type === "symbol"
      ? nameOp.value.name
      : nameOp?.type === "string-literal"
        ? nameOp.content
        : undefined;
  if (name === undefined) return undefined;

  const typeName =
    typeOp === undefined
      ? "code"
      : typeOp.type === "section-type"
        ? typeOp.sectionType
        : typeOp.type === "value" && typeOp.value.type === "symbol"
          ? typeOp.value.name
          : undefined;
  const type = typeName === undefined ? undefined : sectionType(typeName);
  if (!type) return undefined;

  // A numeric memory attribute, or a suffix and an attribute both, is left
  // unknown rather than guessed at.
  let memory = type.memory;
  if (memoryOp) {
    if (memoryOp.type !== "memory-type" || memory) return undefined;
    memory = memoryOp.memoryType;
  }
  return section(name, type.kind, memory, name);
}

/** Directives whose label is an address in the current section. */
const ADDRESS_DIRECTIVES = new Set([
  "dc",
  "ds",
  "dcb",
  "blk",
  "db",
  "dw",
  "dl",
  "incbin",
  "even",
  "cnop",
  "align",
]);

/**
 * Whether a line's label names an address, rather than an EQU, SET, RS or
 * some other value the label happens to be written against.
 */
function definesAddress(line: ParsedLine): boolean {
  const mnemonic = line.mnemonic;
  if (!mnemonic || mnemonic.type === "instruction") return true;
  if (mnemonic.type !== "directive") return false;
  return ADDRESS_DIRECTIVES.has(mnemonic.directive.toLowerCase());
}

/**
 * Macros this file defines whose body cannot change the section: no section
 * directive, INCLUDE, ORG or OFFSET, and no call to a macro that might.
 */
function sectionNeutralMacros(file: ParsedFile): Set<string> {
  // The parsed body of each definition, by name; a name defined twice is null.
  // Only the extent of each definition is wanted, not its text.
  const bodies = new Map<string, ParsedLine[] | null>();
  for (const definition of collectMacroDefinitions(file, [])) {
    const key = nameKey(file, definition.name);
    bodies.set(
      key,
      bodies.has(key)
        ? null
        : file.lines.slice(definition.start + 1, definition.end),
    );
  }

  const neutral = new Set<string>();
  const visiting = new Set<string>();
  const check = (key: string): boolean => {
    if (neutral.has(key)) return true;
    const lines = bodies.get(key);
    if (!lines || visiting.has(key)) return false;
    visiting.add(key);
    const ok = lines.every((line) => {
      const mnemonic = line.mnemonic;
      if (mnemonic?.type === "macro")
        return check(nameKey(file, mnemonic.macro));
      if (mnemonic?.type !== "directive") return true;
      return !MOVES_SECTION.has(mnemonic.directive.toLowerCase());
    });
    visiting.delete(key);
    if (ok) neutral.add(key);
    return ok;
  };
  for (const key of bodies.keys()) check(key);
  return neutral;
}

const MOVES_SECTION = new Set([
  "section",
  "pushsection",
  "popsection",
  "org",
  "offset",
  "include",
  ...Object.keys(SHORTHANDS),
]);
