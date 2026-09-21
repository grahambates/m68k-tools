import type { ParsedLine } from "m68k-parser";
import { semanticMnemonic, canonicalMnemonicName } from "./mnemonics.js";
import { isMacroInvocation } from "../util/ast.js";
import { expansionOf } from "./macro-expansions.js";

export const FLAGS = ["X", "N", "Z", "V", "C"] as const;
export type Flag = (typeof FLAGS)[number];
export type FlagSet = ReadonlySet<Flag>;

export type ControlFlowKind =
  | "fallthrough"
  | "conditional-branch"
  | "unconditional-branch"
  | "call"
  | "return"
  | "dynamic-jump"
  | "stop";

export interface FlagSemantics {
  reads: FlagSet;
  writes: FlagSet;
  undefined: FlagSet;
  controlFlow: ControlFlowKind;
}

const none = (): Set<Flag> => new Set<Flag>();
const set = (...flags: Flag[]): Set<Flag> => new Set(flags);
const NZVC = set("N", "Z", "V", "C");
const XNZVC = set("X", "N", "Z", "V", "C");

const conditionReads: Record<string, readonly Flag[]> = {
  t: [],
  f: [],
  hi: ["C", "Z"],
  ls: ["C", "Z"],
  cc: ["C"],
  hs: ["C"],
  cs: ["C"],
  lo: ["C"],
  ne: ["Z"],
  eq: ["Z"],
  vc: ["V"],
  vs: ["V"],
  pl: ["N"],
  mi: ["N"],
  ge: ["N", "V"],
  lt: ["N", "V"],
  gt: ["N", "V", "Z"],
  le: ["N", "V", "Z"],
};

function conditionFromMnemonic(mnemonic: string): string | undefined {
  const m = canonicalMnemonicName(mnemonic);
  if (m.startsWith("db") && m.length > 2) return m.slice(2);
  if (
    m.startsWith("s") &&
    m.length > 1 &&
    m !== "sub" &&
    m !== "swap" &&
    m !== "stop"
  ) {
    const cc = m.slice(1);
    if (cc in conditionReads) return cc;
  }
  if (
    m.startsWith("b") &&
    m.length > 1 &&
    !["bra", "bsr", "bkpt", "bchg", "bclr", "bset", "btst"].includes(m)
  ) {
    const cc = m.slice(1);
    if (cc in conditionReads) return cc;
  }
  return undefined;
}

/** The condition an instruction tests (`eq`, `hi`...), for Bcc, DBcc and Scc. */
export function conditionCode(mnemonic: string): string | undefined {
  return conditionFromMnemonic(mnemonic);
}

/** Whether an instruction ends the routine by returning to its caller. */
export function isReturn(line: ParsedLine): boolean {
  return getFlagSemantics(line).controlFlow === "return";
}

export function flagsReadByCondition(mnemonic: string): ReadonlySet<Flag> {
  const cc = conditionFromMnemonic(mnemonic);
  return cc ? new Set(conditionReads[cc] ?? []) : none();
}

export function instructionName(line: ParsedLine): string | undefined {
  return semanticMnemonic(line);
}

export function isAddressRegisterWriteWithoutCCR(line: ParsedLine): boolean {
  const mnemonic = instructionName(line);
  if (!mnemonic) return false;

  if (["movea", "adda", "suba", "lea"].includes(mnemonic)) return true;

  // ADDQ/SUBQ retain their own opcode names but preserve CCR when the
  // destination is an address register.
  if (["addq", "subq"].includes(mnemonic)) {
    return line.operands?.[1]?.type === "address-register";
  }

  return false;
}

/**
 * The combined effect of instructions run one after another: a flag is read if
 * some instruction reads it before any has set it, and ends up written or
 * undefined according to whichever touched it last.
 */
function foldFlagSemantics(lines: readonly ParsedLine[]): FlagSemantics {
  const reads = none();
  const writes = none();
  const undefinedFlags = none();
  for (const line of lines) {
    const step = getFlagSemantics(line);
    for (const flag of step.reads)
      if (!writes.has(flag) && !undefinedFlags.has(flag)) reads.add(flag);
    for (const flag of step.writes) {
      writes.add(flag);
      undefinedFlags.delete(flag);
    }
    for (const flag of step.undefined) {
      undefinedFlags.add(flag);
      writes.delete(flag);
    }
  }
  return {
    reads,
    writes,
    undefined: undefinedFlags,
    controlFlow: "fallthrough",
  };
}

/**
 * What an instruction does to the condition codes and to control flow.
 *
 * On a line made conditional by `iif` it may do none of it, which is the same as
 * it doing all of it and the earlier values surviving: what it would write, it
 * also reads, so a value set before it is not dead. A jump or return it would
 * make is then one that may or may not be taken, since the line after it can
 * still run.
 */
export function getFlagSemantics(line: ParsedLine): FlagSemantics {
  const semantics = unconditionalFlagSemantics(line);
  if (line.inlineCondition === undefined) return semantics;
  const controlFlow: ControlFlowKind =
    semantics.controlFlow === "call" || semantics.controlFlow === "fallthrough"
      ? semantics.controlFlow
      : "conditional-branch";
  return {
    reads: new Set([
      ...semantics.reads,
      ...semantics.writes,
      ...semantics.undefined,
    ]),
    writes: none(),
    undefined: none(),
    controlFlow,
  };
}

/**
 * Conservative, deliberately incomplete instruction flag semantics.
 * Unknown instructions preserve our knowledge of existing flags rather than
 * pretending to write them. As the table expands, callers automatically get
 * more precise answers without rule changes.
 */
function unconditionalFlagSemantics(line: ParsedLine): FlagSemantics {
  const expansion = isMacroInvocation(line) ? expansionOf(line) : undefined;
  if (expansion) return foldFlagSemantics(expansion);
  // A macro's body is invisible here, so treat the condition codes the way a
  // JSR is treated: not written to anything knowable, and no longer trustworthy.
  // Execution continues to the next line, since a macro that branches away is
  // rarer than one that does not, and assuming otherwise would sever the flow
  // of every file that uses macros for anything ordinary.
  if (isMacroInvocation(line)) {
    return {
      reads: none(),
      writes: none(),
      undefined: XNZVC,
      controlFlow: "fallthrough",
    };
  }
  const mnemonic = instructionName(line);
  if (!mnemonic)
    return {
      reads: none(),
      writes: none(),
      undefined: none(),
      controlFlow: "fallthrough",
    };

  const conditionReadsSet = flagsReadByCondition(mnemonic);

  if (
    mnemonic === "rts" ||
    mnemonic === "rte" ||
    mnemonic === "rtr" ||
    mnemonic === "rtd"
  ) {
    return {
      reads: none(),
      writes: none(),
      undefined: none(),
      controlFlow: "return",
    };
  }
  if (mnemonic === "stop") {
    return {
      reads: none(),
      writes: none(),
      undefined: none(),
      controlFlow: "stop",
    };
  }
  if (mnemonic === "jsr" || mnemonic === "bsr") {
    return {
      reads: none(),
      writes: none(),
      undefined: XNZVC,
      controlFlow: "call",
    };
  }
  if (mnemonic === "jmp") {
    return {
      reads: none(),
      writes: none(),
      undefined: none(),
      controlFlow: "dynamic-jump",
    };
  }
  if (mnemonic === "bra") {
    return {
      reads: none(),
      writes: none(),
      undefined: none(),
      controlFlow: "unconditional-branch",
    };
  }
  if (mnemonic.startsWith("db") && mnemonic.length > 2) {
    return {
      reads: conditionReadsSet,
      writes: none(),
      undefined: none(),
      controlFlow: "conditional-branch",
    };
  }
  if (conditionReadsSet.size > 0 && mnemonic.startsWith("b")) {
    return {
      reads: conditionReadsSet,
      writes: none(),
      undefined: none(),
      controlFlow: "conditional-branch",
    };
  }
  if (conditionReadsSet.size > 0 && mnemonic.startsWith("s")) {
    return {
      reads: conditionReadsSet,
      writes: none(),
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }

  // Address-register arithmetic/data movement deliberately leaves CCR alone.
  // CMPA is not one of them despite the name: it writes no register, and like
  // every compare it sets N, Z, V and C from the subtraction while leaving X.
  // Grouping it here made `cmpa.l a2,a0 / beq` look like a branch reading a
  // condition nothing had set.
  if (
    isAddressRegisterWriteWithoutCCR(line) ||
    ["pea", "exg", "link", "unlk"].includes(mnemonic)
  ) {
    return {
      reads: none(),
      writes: none(),
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }

  if (["cmp", "cmpa", "cmpm", "tst"].includes(mnemonic)) {
    return {
      reads: none(),
      writes: NZVC,
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }
  if (
    [
      "move",
      "moveq",
      "clr",
      "not",
      "and",
      "or",
      "eor",
      "ext",
      "extb",
      "swap",
    ].includes(mnemonic)
  ) {
    return {
      reads: none(),
      writes: NZVC,
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }
  if (["add", "addq", "sub", "subq", "neg"].includes(mnemonic)) {
    return {
      reads: none(),
      writes: XNZVC,
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }
  if (["mulu", "muls"].includes(mnemonic)) {
    return {
      reads: none(),
      writes: NZVC,
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }
  if (
    ["addx", "subx", "negx", "abcd", "sbcd", "roxl", "roxr"].includes(mnemonic)
  ) {
    return {
      reads: set("X"),
      writes: XNZVC,
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }
  if (["asl", "asr", "lsl", "lsr", "rol", "ror"].includes(mnemonic)) {
    return {
      reads: none(),
      writes: XNZVC,
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }
  if (["btst", "bchg", "bclr", "bset"].includes(mnemonic)) {
    return {
      reads: none(),
      writes: set("Z"),
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }
  if (mnemonic === "tas") {
    return {
      reads: none(),
      writes: NZVC,
      undefined: none(),
      controlFlow: "fallthrough",
    };
  }

  return {
    reads: none(),
    writes: none(),
    undefined: none(),
    controlFlow: "fallthrough",
  };
}

export function isFlagPreservingInstruction(line: ParsedLine): boolean {
  const semantics = getFlagSemantics(line);
  return semantics.writes.size === 0 && semantics.undefined.size === 0;
}
