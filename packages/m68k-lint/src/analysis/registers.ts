import type {
  ExpressionNode,
  OperandNode,
  ParsedFile,
  ParsedLine,
} from "m68k-parser";
import { buildControlFlowGraph, type ControlFlowGraph } from "./cfg.js";
import { evaluateConstant } from "./constants.js";
import {
  DATA_REGISTERS,
  REGISTERS,
  getRegisterSemantics,
  normalizeRegister,
  type Register,
} from "../semantics/registers.js";
import { instructionSize, isExecutableLine } from "../util/ast.js";
import { semanticMnemonic } from "../semantics/mnemonics.js";

export type RegisterLiveness = "dead" | "live" | "unknown";
export type RegisterValue =
  { kind: "constant"; value: number } | { kind: "unknown" };
const UNKNOWN: RegisterValue = { kind: "unknown" };

function mergeLive(a: RegisterLiveness, b: RegisterLiveness): RegisterLiveness {
  if (a === "live" || b === "live") return "live";
  if (a === "unknown" || b === "unknown") return "unknown";
  return "dead";
}
function sameValue(a: RegisterValue, b: RegisterValue): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === "unknown" || (b.kind === "constant" && a.value === b.value))
  );
}
function normalize32(n: number): number {
  return n | 0;
}
function signExtend(value: number, bits: 8 | 16): number {
  return bits === 8 ? (value << 24) >> 24 : (value << 16) >> 16;
}
function applyShift(
  kind: string,
  value: number,
  count: number,
): number | undefined {
  const n = count & 63;
  switch (kind) {
    case "lsl":
    case "asl":
      return normalize32(value << n);
    case "lsr":
      return normalize32((value >>> n) >>> 0);
    case "asr":
      return normalize32(value >> n);
    default:
      return undefined;
  }
}
function immediateExpr(
  line: ParsedLine,
  index: number,
): ExpressionNode | undefined {
  const op = line.operands?.[index];
  return op?.type === "immediate" ? op.value : undefined;
}
function directRegister(line: ParsedLine, index: number): Register | undefined {
  const op = line.operands?.[index];
  if (op?.type !== "data-register" && op?.type !== "address-register")
    return undefined;
  return normalizeRegister(op.register);
}

/**
 * Operand shapes in which an address register supplies the base address. All
 * 32 bits take part in forming it, whatever width the operand transfers.
 */
const BASE_ADDRESS_OPERANDS = new Set([
  "address-register-indirect",
  "address-register-indirect-postinc",
  "address-register-indirect-predec",
  "address-register-indirect-displacement",
  "address-register-indirect-index",
  "memory-indirect",
]);

function baseRegisterOf(op: OperandNode): Register | undefined {
  const base = (op as { register?: { type?: string; register?: string } })
    .register;
  if (!base || base.type !== "address-register" || !base.register)
    return undefined;
  return normalizeRegister(base.register);
}

function isFullDataRegisterOverwriteWithoutUpperRead(
  line: ParsedLine,
  register: Register,
): boolean {
  if (!register.startsWith("d")) return false;
  const mnemonic = semanticMnemonic(line);
  const size = instructionSize(line);
  const dst0 = directRegister(line, 0);
  const dst1 = directRegister(line, 1);
  if (mnemonic === "moveq" && dst1 === register) return true;
  if (mnemonic === "move" && size === "l" && dst1 === register) return true;
  if (mnemonic === "clr" && size === "l" && dst0 === register) return true;
  if (
    ((mnemonic === "ext" && size === "l") || mnemonic === "extb") &&
    dst0 === register
  )
    return true;
  return false;
}

/**
 * A register named in any assembler spelling. Callers pass raw source text such
 * as "D0", "sp" or "a7", which `normalizeRegister` resolves to a `Register`.
 *
 * The `Register` half widens to `string` at the type level, so this is `string`
 * in practice; `& {}` keeps the union from collapsing so editors still offer the
 * canonical names as completions.
 */
export type RegisterLike = Register | (string & {});

export type RegisterBitsUse = "unused" | "used" | "unknown";
export type UpperWordUse = RegisterBitsUse;

export interface RegisterAnalysis {
  readonly cfg: ControlFlowGraph;
  isLiveAfter(index: number, register: RegisterLike): RegisterLiveness;
  valueBefore(index: number, register: RegisterLike): RegisterValue;
  valueAfter(index: number, register: RegisterLike): RegisterValue;
  knownConstantBefore(
    index: number,
    register: RegisterLike,
  ): number | undefined;
  deadDataRegistersAfter(index: number): readonly Register[];
  /**
   * Whether any of `mask`'s bits are read before being overwritten.
   *
   * Defined for address registers as well as data registers: using one as a
   * base address reads all 32 bits of it, which is how a sign-extended upper
   * half becomes observable.
   */
  registerBitsUseAfter(
    index: number,
    register: RegisterLike,
    mask: number,
  ): RegisterBitsUse;
  upperWordUseAfter(index: number, register: RegisterLike): UpperWordUse;
}

export function analyzeRegisters(
  file: ParsedFile,
  resolveSymbol?: (name: string) => number | undefined,
): RegisterAnalysis {
  const cfg = buildControlFlowGraph(file);
  const registerBitsUseMemo = new Map<string, RegisterBitsUse>();
  const liveIn = file.lines.map(() => new Map<Register, RegisterLiveness>());
  const liveOut = file.lines.map(() => new Map<Register, RegisterLiveness>());
  for (const maps of [liveIn, liveOut])
    for (const map of maps) for (const r of REGISTERS) map.set(r, "dead");

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = file.lines.length - 1; i >= 0; i--) {
      const line = file.lines[i];
      if (!isExecutableLine(line)) continue;
      const sem = getRegisterSemantics(line);
      for (const r of REGISTERS) {
        let out: RegisterLiveness = cfg.escapes[i] ? "unknown" : "dead";
        for (const succ of cfg.successors[i])
          out = mergeLive(out, liveIn[succ].get(r) ?? "dead");
        let before: RegisterLiveness;
        if (sem.reads.has(r)) before = "live";
        // A byte or word write to a data register leaves the bits above it in
        // place, so it does not end the life of what was there: the register is
        // live before exactly when those surviving bits are live after.
        else if (sem.partialWrites.has(r)) before = out;
        else if (sem.writes.has(r)) before = "dead";
        else if (sem.unknownEffects) before = "unknown";
        else before = out;
        if (liveOut[i].get(r) !== out) {
          liveOut[i].set(r, out);
          changed = true;
        }
        if (liveIn[i].get(r) !== before) {
          liveIn[i].set(r, before);
          changed = true;
        }
      }
    }
  }

  const beforeValues = file.lines.map(() => new Map<Register, RegisterValue>());
  const afterValues = file.lines.map(() => new Map<Register, RegisterValue>());
  for (const maps of [beforeValues, afterValues])
    for (const map of maps) for (const r of REGISTERS) map.set(r, UNKNOWN);

  const evalExpr = (expr: ExpressionNode): number | undefined => {
    const result = evaluateConstant(expr, resolveSymbol);
    return result.known ? result.value : undefined;
  };

  changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (!isExecutableLine(line)) continue;
      const sem = getRegisterSemantics(line);

      for (const r of REGISTERS) {
        const preds = cfg.predecessors[i];
        let incoming: RegisterValue = UNKNOWN;
        if (preds.size > 0) {
          let first = true;
          for (const pred of preds) {
            const v = afterValues[pred].get(r) ?? UNKNOWN;
            if (first) {
              incoming = v;
              first = false;
            } else if (!sameValue(incoming, v)) {
              incoming = UNKNOWN;
              break;
            }
          }
        }
        if (!sameValue(beforeValues[i].get(r) ?? UNKNOWN, incoming)) {
          beforeValues[i].set(r, incoming);
          changed = true;
        }

        let outgoing = incoming;
        if (sem.unknownEffects && !sem.writes.has(r)) outgoing = UNKNOWN;
        if (sem.writes.has(r)) outgoing = UNKNOWN;

        const mnemonic = semanticMnemonic(line)!;
        const dst1 = directRegister(line, 1);
        const dst0 = directRegister(line, 0);
        const size = instructionSize(line);
        const imm0 = immediateExpr(line, 0);
        const immediate = imm0 ? evalExpr(imm0) : undefined;

        // Definite full-register values. Partial Dn writes are deliberately left unknown.
        if (dst1 === r && mnemonic === "moveq" && immediate !== undefined)
          outgoing = {
            kind: "constant",
            value: normalize32((immediate << 24) >> 24),
          };
        else if (dst1 === r && ["move", "movea"].includes(mnemonic)) {
          const src = directRegister(line, 0);
          if (
            immediate !== undefined &&
            (size === "l" || dst1.startsWith("a"))
          ) {
            const value =
              size === "w" && dst1.startsWith("a")
                ? (immediate << 16) >> 16
                : normalize32(immediate);
            outgoing = { kind: "constant", value };
          } else if (src && (size === "l" || dst1.startsWith("a")))
            outgoing = beforeValues[i].get(src) ?? UNKNOWN;
        } else if (dst0 === r && mnemonic === "clr" && size === "l")
          outgoing = { kind: "constant", value: 0 };
        else if (
          dst1 === r &&
          ["sub", "suba"].includes(mnemonic) &&
          directRegister(line, 0) === dst1 &&
          (size === "l" || dst1.startsWith("a"))
        ) {
          outgoing = { kind: "constant", value: 0 };
        } else if (dst1 === r && mnemonic === "lea") {
          const source = line.operands?.[0];
          if (source?.type === "absolute-address") {
            const value = evalExpr(source.address);
            if (value !== undefined)
              outgoing = { kind: "constant", value: normalize32(value) };
          }
        } else if (
          dst1 === r &&
          ["addq", "subq"].includes(mnemonic) &&
          immediate !== undefined
        ) {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (
            prior.kind === "constant" &&
            (size === "l" || r.startsWith("a"))
          ) {
            outgoing = {
              kind: "constant",
              value: normalize32(
                prior.value + (mnemonic === "addq" ? immediate : -immediate),
              ),
            };
          }
        } else if (
          dst1 === r &&
          ["add", "sub"].includes(mnemonic) &&
          immediate !== undefined
        ) {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant" && size === "l") {
            const delta = mnemonic.startsWith("sub") ? -immediate : immediate;
            outgoing = {
              kind: "constant",
              value: normalize32(prior.value + delta),
            };
          }
        } else if (
          dst1 === r &&
          ["adda", "suba"].includes(mnemonic) &&
          immediate !== undefined
        ) {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant") {
            const src =
              size === "w" ? signExtend(immediate, 16) : normalize32(immediate);
            const delta = mnemonic === "suba" ? -src : src;
            outgoing = {
              kind: "constant",
              value: normalize32(prior.value + delta),
            };
          }
        } else if (
          dst1 === r &&
          ["and", "or", "eor"].includes(mnemonic) &&
          immediate !== undefined &&
          size === "l"
        ) {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant") {
            const imm = normalize32(immediate);
            let v: number | undefined;
            if (mnemonic.startsWith("and")) v = prior.value & imm;
            else if (mnemonic.startsWith("or")) v = prior.value | imm;
            else v = prior.value ^ imm;
            outgoing = { kind: "constant", value: normalize32(v) };
          }
        } else if (dst0 === r && mnemonic === "not" && size === "l") {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant")
            outgoing = { kind: "constant", value: normalize32(~prior.value) };
        } else if (dst0 === r && mnemonic === "neg" && size === "l") {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant")
            outgoing = { kind: "constant", value: normalize32(-prior.value) };
        } else if (dst0 === r && mnemonic === "swap") {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant") {
            const u = prior.value >>> 0;
            outgoing = {
              kind: "constant",
              value: normalize32(((u & 0xffff) << 16) | (u >>> 16)),
            };
          }
        } else if (dst0 === r && ["ext", "extb"].includes(mnemonic)) {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant") {
            if (mnemonic === "extb")
              outgoing = {
                kind: "constant",
                value: signExtend(prior.value & 0xff, 8),
              };
            else if (size === "w") {
              const low = signExtend(prior.value & 0xff, 8) & 0xffff;
              outgoing = {
                kind: "constant",
                value: normalize32((prior.value & ~0xffff) | low),
              };
            } else if (size === "l")
              outgoing = {
                kind: "constant",
                value: signExtend(prior.value & 0xffff, 16),
              };
          }
        } else if (
          dst1 === r &&
          ["muls", "mulu"].includes(mnemonic) &&
          immediate !== undefined &&
          size === "w"
        ) {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant") {
            const lhsUnsigned = prior.value & 0xffff;
            const rhsUnsigned = immediate & 0xffff;
            const lhs =
              mnemonic === "muls" ? signExtend(lhsUnsigned, 16) : lhsUnsigned;
            const rhs =
              mnemonic === "muls" ? signExtend(rhsUnsigned, 16) : rhsUnsigned;
            outgoing = { kind: "constant", value: normalize32(lhs * rhs) };
          }
        } else if (
          dst1 === r &&
          ["lsl", "lsr", "asl", "asr"].includes(mnemonic) &&
          immediate !== undefined &&
          size === "l"
        ) {
          const prior = beforeValues[i].get(r) ?? UNKNOWN;
          if (prior.kind === "constant") {
            const shifted = applyShift(mnemonic, prior.value, immediate);
            if (shifted !== undefined)
              outgoing = { kind: "constant", value: shifted };
          }
        }

        if (!sameValue(afterValues[i].get(r) ?? UNKNOWN, outgoing)) {
          afterValues[i].set(r, outgoing);
          changed = true;
        }
      }
    }
  }

  const reg = (value: RegisterLike) =>
    normalizeRegister(value) ?? (value as Register);
  const registerBitsUseAfter = (
    index: number,
    register: RegisterLike,
    differingMask: number,
  ): RegisterBitsUse => {
    const target = reg(register);
    const mask = differingMask >>> 0;
    if (mask === 0) return "unused";
    const visiting = new Set<number>();
    const memo = registerBitsUseMemo;
    const directReadMask = (line: ParsedLine): number | undefined => {
      const size = instructionSize(line);
      const mnemonic = semanticMnemonic(line);
      // DIVU and DIVS take a 32-bit dividend however the size is written: the
      // `.w` names the divisor and the quotient, not the operand read out of
      // the register. Dividing after writing only the low word is the classic
      // way to get a wrong answer, and modelling the read as 16 bits hid it.
      const longDividend = mnemonic === "divu" || mnemonic === "divs";
      // EXT and EXTB read a narrower operand than their suffix names: the
      // suffix is the width of the *result*. EXT.W reads the low byte and
      // writes the low word, EXT.L reads the low word, EXTB.L reads the low
      // byte. Modelling the read at the result's width made the bits the
      // instruction is about to overwrite look observed, which reported the
      // ordinary `move.b (a0)+,d0 / ext.w d0` sign-extension as a partial
      // write whose preserved bits are used.
      const extendedSourceMask =
        mnemonic === "extb"
          ? 0xff
          : mnemonic === "ext"
            ? size === "l"
              ? 0xffff
              : 0xff
            : undefined;
      let readMask = 0;
      let saw = false;
      for (const [position, op] of (line.operands ?? []).entries()) {
        if (
          op.type === "data-register" &&
          normalizeRegister(op.register) === target
        ) {
          saw = true;
          if (longDividend && position === 1) readMask = 0xffffffff;
          else if (extendedSourceMask !== undefined)
            readMask |= extendedSourceMask;
          else if (size === "b") readMask |= 0xff;
          else if (size === "w") readMask |= 0xffff;
          else if (size === "l") readMask = 0xffffffff;
          else return undefined;
        } else if (
          op.type === "register-list" &&
          op.registers.some((r: string) => normalizeRegister(r) === target)
        ) {
          saw = true;
          if (size === "w") readMask |= 0xffff;
          else if (size === "l") readMask = 0xffffffff;
          else return undefined;
        } else if (
          op.type === "address-register" &&
          normalizeRegister(op.register) === target
        ) {
          saw = true;
          // Read as a value rather than an address: only the operand's width.
          if (size === "w") readMask |= 0xffff;
          else if (size === "l") readMask = 0xffffffff;
          else return undefined;
        } else if (
          BASE_ADDRESS_OPERANDS.has(op.type) &&
          baseRegisterOf(op) === target
        ) {
          // Used as an address. The whole register forms it, whatever the
          // operand's size, so a sign-extended upper half is observed here.
          saw = true;
          readMask = 0xffffffff;
        } else if (
          op.type === "address-register-indirect-index" ||
          op.type === "pc-relative-index" ||
          op.type === "memory-indirect"
        ) {
          const idx = op.indexRegister;
          if (
            idx?.type === "data-register" &&
            normalizeRegister(idx.register) === target
          ) {
            saw = true;
            const idxSize =
              op.indexSize?.type === "size" ? op.indexSize.size : undefined;
            if (idxSize === "w") readMask |= 0xffff;
            else if (idxSize === "l") readMask = 0xffffffff;
            else return undefined;
          }
        }
      }
      return saw ? readMask >>> 0 : 0;
    };
    /**
     * SWAP Dn exchanges the register's halves. It neither observes nor discards
     * the bits being tracked, it relocates them, so follow the rotated mask
     * rather than giving up. Without this a DIVU.W remainder read via
     * `swap dn` / `move.l dn,...` looks unobserved.
     */
    const swappedTarget = (line: ParsedLine): boolean => {
      if (semanticMnemonic(line) !== "swap") return false;
      const ops = line.operands ?? [];
      return (
        ops.length === 1 &&
        ops[0].type === "data-register" &&
        normalizeRegister(ops[0].register) === target
      );
    };
    const rotateHalves = (mask: number): number =>
      ((mask << 16) | (mask >>> 16)) >>> 0;

    /** Bits this instruction writes into the target data register, if knowable. */
    const directWriteMask = (line: ParsedLine): number | undefined => {
      const size = instructionSize(line);
      const semantics = getRegisterSemantics(line);
      if (!semantics.writes.has(target)) return 0;
      // Only a destination written as a plain data register is width-bounded.
      // A register list, or an operand shape not handled here, is not.
      const direct = (line.operands ?? []).some(
        (op) =>
          (op.type === "data-register" || op.type === "address-register") &&
          normalizeRegister(op.register) === target,
      );
      if (!direct) return undefined;
      // Arithmetic that reads an address register and writes it back keeps the
      // dependence: the upper half of an ADDA result is derived from the upper
      // half that went in, so it neither observes the query's bits nor ends
      // their life. Passing the mask through unchanged is the honest transfer;
      // calling it a full read reported a value that is only ever read back as
      // a word, and calling it a kill lost the case that is read as a long.
      if (semantics.reads.has(target) && !target.startsWith("d")) return 0;
      if (!semantics.partialWrites.has(target)) return 0xffffffff;
      if (size === "b") return 0xff;
      if (size === "w") return 0xffff;
      return undefined;
    };

    const walk = (start: number, startMask: number): RegisterBitsUse => {
      interface Frame {
        i: number;
        currentMask: number;
        key: string;
        successors?: number[];
        nextSuccessor?: number;
        aggregate?: RegisterBitsUse;
        childResult?: RegisterBitsUse;
      }

      const frames: Frame[] = [];
      let result: RegisterBitsUse | undefined;
      const finish = (state: RegisterBitsUse) => {
        const frame = frames.pop()!;
        visiting.delete(frame.i);
        memo.set(frame.key, state);
        const parent = frames.at(-1);
        if (parent) parent.childResult = state;
        else result = state;
      };
      const push = (i: number, currentMask: number) => {
        const key = `${target}:${i}:${currentMask >>> 0}`;
        const cached = memo.get(key);
        if (cached) {
          const parent = frames.at(-1);
          if (parent) parent.childResult = cached;
          else result = cached;
          return;
        }
        if (visiting.has(i)) {
          const parent = frames.at(-1);
          if (parent) parent.childResult = "unknown";
          else result = "unknown";
          return;
        }
        visiting.add(i);
        frames.push({ i, currentMask, key });
      };

      push(start, startMask);
      while (frames.length > 0) {
        const frame = frames.at(-1)!;
        if (frame.successors) {
          if (frame.childResult) {
            if (frame.childResult === "used") frame.aggregate = "used";
            else if (
              frame.childResult === "unknown" &&
              frame.aggregate !== "used"
            )
              frame.aggregate = "unknown";
            frame.childResult = undefined;
            frame.nextSuccessor!++;
          }
          if (
            frame.aggregate === "used" ||
            frame.nextSuccessor === frame.successors.length
          ) {
            finish(frame.aggregate!);
            continue;
          }
          push(frame.successors[frame.nextSuccessor!], frame.currentMask);
          continue;
        }

        const line = file.lines[frame.i];
        if (!line?.mnemonic || line.mnemonic.type !== "instruction") {
          finish("unknown");
          continue;
        }
        const sem = getRegisterSemantics(line);
        // Calls may consume any part of a register, even when it is absent
        // from their explicit operands. Do not prove bits unused across an
        // instruction whose effects we cannot account for.
        if (sem.unknownEffects) {
          finish("unknown");
          continue;
        }
        if (swappedTarget(line)) {
          frame.currentMask = rotateHalves(frame.currentMask);
        } else {
          if (sem.reads.has(target)) {
            const readMask = directReadMask(line);
            if (readMask === undefined) {
              finish("unknown");
              continue;
            }
            if (((readMask >>> 0) & (frame.currentMask >>> 0)) !== 0) {
              finish("used");
              continue;
            }
          }
          if (sem.writes.has(target)) {
            if (isFullDataRegisterOverwriteWithoutUpperRead(line, target)) {
              finish("unused");
              continue;
            }
            const writeMask = directWriteMask(line);
            if (writeMask === undefined) {
              finish("unknown");
              continue;
            }
            const remaining = (frame.currentMask & ~writeMask) >>> 0;
            if (remaining === 0) {
              finish("unused");
              continue;
            }
            frame.currentMask = remaining;
          }
        }
        const successors = [...cfg.successors[frame.i]];
        frame.successors = successors;
        frame.nextSuccessor = 0;
        frame.aggregate =
          cfg.escapes[frame.i] || successors.length === 0
            ? "unknown"
            : "unused";
      }
      return result!;
    };
    const starts = [...cfg.successors[index]];
    if (starts.length === 0) return cfg.escapes[index] ? "unknown" : "unused";
    let aggregate: RegisterBitsUse = "unused";
    for (const start of starts) {
      const state = walk(start, mask);
      if (state === "used") return "used";
      if (state === "unknown") aggregate = "unknown";
    }
    return aggregate;
  };

  return {
    cfg,
    isLiveAfter(index, register) {
      return liveOut[index]?.get(reg(register)) ?? "unknown";
    },
    valueBefore(index, register) {
      return beforeValues[index]?.get(reg(register)) ?? UNKNOWN;
    },
    valueAfter(index, register) {
      return afterValues[index]?.get(reg(register)) ?? UNKNOWN;
    },
    knownConstantBefore(index, register) {
      const v = beforeValues[index]?.get(reg(register)) ?? UNKNOWN;
      return v.kind === "constant" ? v.value : undefined;
    },
    deadDataRegistersAfter(index) {
      return DATA_REGISTERS.filter(
        (r) => (liveOut[index]?.get(r) ?? "unknown") === "dead",
      );
    },
    registerBitsUseAfter(index, register, mask) {
      return registerBitsUseAfter(index, register, mask);
    },
    upperWordUseAfter(index, register) {
      return registerBitsUseAfter(index, register, 0xffff0000);
    },
  };
}
