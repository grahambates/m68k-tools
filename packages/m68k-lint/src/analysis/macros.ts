import {
  collectMacroDefinitions,
  expandMacro,
  macroInvocation,
  parseBlocks,
  type ExpressionNode,
  type MacroDefinition,
  type OperandNode,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";
import { getFlagSemantics } from "../semantics/flags.js";
import { setExpansion } from "../semantics/macro-expansions.js";
import { nameKey } from "./case-mode.js";
import { evaluateCondition } from "./conditionals.js";
import type { ExternalSymbols } from "./symbols.js";
import { scanBlocks } from "./blocks.js";
import { registersOf } from "./register-saves.js";

/**
 * Work out what macro calls stand for, so the register, flag and stack
 * analyses can see through them instead of treating each as opaque.
 *
 * The expansion itself is `expandMacro` from m68k-parser, which substitutes
 * arguments into the body as text and parses the result, as the assembler
 * does. This decides which expansions are safe to reason about.
 *
 * Deliberately limited to the simple case: a macro is seen through only when
 * what it expands to is a straight run of instructions. Conditional assembly
 * in the body is settled first, when it depends on nothing but the arguments
 * and constants the file knows, so `if narg>1` and `ifb \2` pick their arm.
 * Labels, branches, other directives, calls to macros that cannot be expanded,
 * conditions that cannot be settled, text the parser objected to, and any
 * parameter left unsubstituted all leave the call opaque, exactly as before.
 *
 * A macro defined in the file itself is used first. A name the file does not
 * define is looked up in the project index, which answers only where every
 * definition of that name in the project has the same body. That is a
 * project-wide match by name, not a walk of the include graph: a header
 * included on some targets and not others is treated as if it always applied.
 */

const prepared = new WeakSet<ParsedFile>();

/**
 * Expand what can be expanded in a file. Safe to call repeatedly.
 *
 * Needs the source text as well as the parse, since a macro body is expanded
 * from what was written.
 */
export function prepareMacros(
  file: ParsedFile,
  source: string,
  external?: ExternalSymbols,
  evaluate: (expr: ExpressionNode) => number | undefined = () => undefined,
): void {
  if (prepared.has(file)) return;
  prepared.add(file);

  const sourceLines = source.split(/\r?\n/);
  const structure = parseBlocks(file);
  const regions = scanBlocks(file).region;

  // A name defined twice, or not defined before the call, is ambiguous.
  const definitions = new Map<string, MacroDefinition | null>();
  for (const definition of collectMacroDefinitions(
    file,
    sourceLines,
    structure,
  )) {
    const key = nameKey(file, definition.name);
    definitions.set(key, definitions.has(key) ? null : definition);
  }
  // The file's own definition wins. A name it does not define may be one the
  // project does, in an include, which is taken to come before every call.
  const defined = (name: string, before: number) => {
    const key = nameKey(file, name);
    if (!definitions.has(key)) return external?.macro?.(name)?.definition;
    const definition = definitions.get(key);
    return definition && definition.start < before ? definition : undefined;
  };

  let unique = 0;
  const saves: (readonly string[] | undefined)[] = [];

  file.lines.forEach((line, index) => {
    if (line.mnemonic?.type !== "macro" || regions[index] !== 0) return;
    const written = line.mnemonic.macro;
    const name = nameKey(file, written);

    const projectDefinition =
      !definitions.has(name) && external?.macro?.(written) !== undefined;
    if (definitions.has(name) || projectDefinition) {
      const definition = defined(written, index);
      const lines =
        definition &&
        expandSimply(
          definition,
          line,
          sourceLines[index] ?? "",
          (n) => defined(n, index),
          () => String(unique++),
          evaluate,
        );
      if (lines) setExpansion(line, lines);
      return;
    }

    // PUSHM and POPM come with the Amiga NDK. POPM takes a register list like
    // MOVEM, or none and restores what the matching PUSHM saved. That pairing
    // is made at assembly time, in source order, which is the order walked here.
    // These are the NDK's names for its own macros, matched as they are
    // conventionally written whatever case the project's symbols keep.
    const ndk = written.toLowerCase();
    if (ndk === "pushm") {
      const registers = registerList(line.operands);
      saves.push(registers);
      if (registers) setExpansion(line, [movem(line, registers, "push")]);
    } else if (ndk === "popm") {
      if (!line.operands?.length) {
        const registers = saves.pop();
        if (registers) setExpansion(line, [movem(line, registers, "pop")]);
        return;
      }
      const registers = registerList(line.operands);
      if (!registers) return;
      setExpansion(line, [movem(line, registers, "pop")]);
      // A list written out closes the PUSHM it matches. One that matches
      // nothing is left alone rather than misaligning later pairs.
      const top = saves[saves.length - 1];
      if (top && top.join() === registers.join()) saves.pop();
    }
  });
}

/**
 * The instructions a call expands to, or undefined unless they are all plain
 * ones that run straight through.
 */
function expandSimply(
  definition: MacroDefinition,
  call: ParsedLine,
  callText: string,
  resolve: (name: string) => MacroDefinition | undefined,
  unique: () => string,
  evaluate: (expr: ExpressionNode) => number | undefined,
): ParsedLine[] | undefined {
  const expansion = expandMacro(definition, macroInvocation(call, callText), {
    resolve,
    unique,
  });
  if (expansion.incomplete) return undefined;

  const lines: ParsedLine[] = [];
  // Conditional assembly in the body, settled as the assembler would: each
  // frame is one IF block, and a line counts only if every arm around it is
  // being assembled.
  const frames: { active: boolean; taken: boolean }[] = [];
  const live = (upTo = frames.length) =>
    frames.slice(0, upTo).every((frame) => frame.active);

  for (const expanded of expansion.lines) {
    // The call to another macro is replaced by the lines it expanded to.
    if (expanded.expandedCall) continue;
    const { line } = expanded;
    if (expanded.errors.length > 0) return undefined;

    const directive =
      line.mnemonic?.type === "directive"
        ? line.mnemonic.directive.toLowerCase()
        : undefined;
    if (directive && !line.label) {
      if (directive === "endc" || directive === "endif") {
        if (!frames.pop()) return undefined;
        continue;
      }
      if (directive === "else" || directive === "elseif") {
        const frame = frames[frames.length - 1];
        if (!frame) return undefined;
        if (!live(frames.length - 1) || frame.taken) {
          frame.active = false;
          continue;
        }
        const arm =
          directive === "else"
            ? "yes"
            : evaluateCondition(directive, line.operands, evaluate);
        if (arm === undefined || arm === "maybe") return undefined;
        frame.active = arm === "yes";
        frame.taken = frame.active;
        continue;
      }
      if (directive.startsWith("if")) {
        if (!live()) {
          frames.push({ active: false, taken: true });
          continue;
        }
        const arm = evaluateCondition(directive, line.operands, evaluate);
        if (arm === undefined || arm === "maybe") return undefined;
        frames.push({ active: arm === "yes", taken: arm === "yes" });
        continue;
      }
    }
    // Not assembled.
    if (!live()) continue;

    // A parameter still in the text was not understood, and one that expanded
    // to nothing leaves an operand missing. Neither says what the line does.
    if (expanded.text.includes("\\")) return undefined;
    if (/(^|,)\s*(,|$)/.test(expanded.text.replace(/;.*$/, "").trim()))
      return undefined;

    if (!line.mnemonic) {
      if (line.label) return undefined;
      continue;
    }
    if (
      line.label ||
      line.mnemonic.type !== "instruction" ||
      getFlagSemantics(line).controlFlow !== "fallthrough"
    )
      return undefined;
    lines.push(line);
  }
  if (frames.length > 0) return undefined;
  return lines;
}

/** `movem.l list,-(sp)` or `movem.l (sp)+,list`, standing in for PUSHM or POPM. */
function movem(
  call: ParsedLine,
  registers: readonly string[],
  kind: "push" | "pop",
): ParsedLine {
  const loc = call.mnemonic!.loc;
  const sp = { type: "address-register", register: "sp", loc } as const;
  const list: OperandNode = {
    type: "register-list",
    raw: [...registers],
    registers: [...registers],
    loc,
  } as OperandNode;
  return {
    ...call,
    label: undefined,
    mnemonic: { type: "instruction", instruction: "movem", loc },
    qualifier: { type: "size", size: "l", loc },
    operands:
      kind === "push"
        ? [
            list,
            { type: "address-register-indirect-predec", register: sp, loc },
          ]
        : [
            { type: "address-register-indirect-postinc", register: sp, loc },
            list,
          ],
  };
}

function registerList(
  operands: readonly OperandNode[] | undefined,
): string[] | undefined {
  return operands?.length === 1 ? registersOf(operands[0]) : undefined;
}
