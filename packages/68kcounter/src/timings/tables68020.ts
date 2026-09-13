import { type Timing } from ".";
import {
  type AddressingMode,
  AddressingModes as O,
  addressingModeGroups as OG,
  type Mnemonic,
  Mnemonics as M,
  mnemonicGroups,
  type Qualifier,
  Qualifiers,
} from "../syntax";

/**
 * 68020 timing data, transcribed from the MC68020 User's Manual §8.2
 * ("Instruction Timing Tables").
 *
 * The manual gives three cases per entry: best / cache / worst, each written
 * `clocks(reads / prefetches / writes)`. The **best case** assumes maximum
 * pipeline overlap with neighbouring instructions (the head/tail effect) and so
 * can't be computed per-instruction in isolation — it is deferred. We model the
 * **cache..worst** range here:
 *
 *   - cache: instruction in the cache, no inter-instruction overlap.
 *   - worst: instruction not in the cache (or cache disabled), no overlap.
 *
 * Each timing is `[clocks, reads, prefetches, writes]`. Unlike the 68000 (which
 * lumps all read cycles together), the 68020 separates operand reads from
 * instruction-stream accesses (prefetches) — both matter for Amiga bus
 * contention, so all three counts are kept.
 *
 * Assumes 32-bit bus, long-word aligned operands, no wait states (per the
 * manual's stated assumptions).
 */

/** A cache-case / worst-case pair of timings. */
export type Timing2 = [cache: Timing, worst: Timing];

/** Which effective-address table to fold into an EA operand's base timing. */
export type EaKind =
  "fetch" | "calc" | "jump" | "fetchImm" | "fetchImmL" | "calcImm";

/**
 * A 68020 base-timing row:
 *   [mnemonics, qualifiers, operands, timing, eaKind?, multiplier?]
 *
 * `timing` is either a single outcome `[cache, worst]` (most instructions) or,
 * for instructions with several runtime outcomes (branches, TRAPV, CAS), a list
 * of such pairs `[[cache, worst], …]` — one per outcome (e.g. taken/not-taken).
 * The chosen cache model reduces each outcome to a single value at lookup time.
 *
 * An operand given as an array is an effective-address operand: the row is
 * expanded over those modes and the corresponding EA time is folded in.
 */
export type Timing2Row = [
  Mnemonic[],
  (Qualifier | null)[],
  (AddressingMode | AddressingMode[])[],
  Timing2 | Timing2[],
  EaKind?,
  // Optional per-n multiplier (e.g. MOVEM: cost per register transferred),
  // applied by instructionTimings using the register-list count.
  Timing?,
];

const { B, W, L } = Qualifiers;
const { SCC, BCC, DBCC } = mnemonicGroups;
const EA = OG.EA;
const Mem = OG.M;

// §8.2.1 Fetch Effective Address — cache/worst, [clocks, reads, prefetch, writes].
// prettier-ignore
export const fetchEa: Partial<Record<AddressingMode, Timing2>> = {
  //                cache             worst
  [O.Dn]:        [ [0, 0, 0, 0],    [0, 0, 0, 0]  ],
  [O.An]:        [ [0, 0, 0, 0],    [0, 0, 0, 0]  ],
  [O.AnIndir]:   [ [4, 1, 0, 0],    [4, 1, 0, 0]  ],
  [O.AnPostInc]: [ [4, 1, 0, 0],    [4, 1, 0, 0]  ],
  [O.AnPreDec]:  [ [5, 1, 0, 0],    [5, 1, 0, 0]  ],
  [O.AnDisp]:    [ [5, 1, 0, 0],    [6, 1, 1, 0]  ],
  [O.PcDisp]:    [ [5, 1, 0, 0],    [6, 1, 1, 0]  ],
  [O.AbsW]:      [ [4, 1, 0, 0],    [6, 1, 1, 0]  ],
  [O.AbsL]:      [ [4, 1, 0, 0],    [7, 1, 1, 0]  ],
  // Immediate (byte/word form; #.L differs slightly and isn't distinguished)
  [O.Imm]:       [ [2, 0, 0, 0],    [3, 0, 1, 0]  ],
  // Brief-format indexed (d8); d8 vs d16 not distinguished
  [O.AnDispIx]:  [ [7, 1, 0, 0],    [8, 1, 1, 0]  ],
  [O.PcDispIx]:  [ [7, 1, 0, 0],    [8, 1, 1, 0]  ],
  // Memory indirect: ([B],I) as a representative value
  [O.MemIndir]:  [ [12, 2, 0, 0],   [13, 2, 1, 0] ],
};

// §8.2.3 Calculate Effective Address — for write-only destinations that don't
// read the operand (CLR/Scc/TAS to memory, LEA/PEA).
// prettier-ignore
export const calcEa: Partial<Record<AddressingMode, Timing2>> = {
  //                cache             worst
  [O.Dn]:        [ [0, 0, 0, 0],    [0, 0, 0, 0]  ],
  [O.An]:        [ [0, 0, 0, 0],    [0, 0, 0, 0]  ],
  [O.AnIndir]:   [ [2, 0, 0, 0],    [2, 0, 0, 0]  ],
  [O.AnPostInc]: [ [2, 0, 0, 0],    [2, 0, 0, 0]  ],
  [O.AnPreDec]:  [ [2, 0, 0, 0],    [2, 0, 0, 0]  ],
  [O.AnDisp]:    [ [2, 0, 0, 0],    [3, 0, 1, 0]  ],
  [O.PcDisp]:    [ [2, 0, 0, 0],    [3, 0, 1, 0]  ],
  [O.AbsW]:      [ [2, 0, 0, 0],    [3, 0, 1, 0]  ],
  [O.AbsL]:      [ [4, 0, 0, 0],    [5, 0, 1, 0]  ],
  [O.AnDispIx]:  [ [4, 0, 0, 0],    [5, 0, 1, 0]  ],
  [O.PcDispIx]:  [ [4, 0, 0, 0],    [5, 0, 1, 0]  ],
  [O.MemIndir]:  [ [11, 1, 0, 0],   [12, 1, 1, 0] ],
};

// §8.2.5 Jump Effective Address — for JMP/JSR targets.
// prettier-ignore
export const jumpEa: Partial<Record<AddressingMode, Timing2>> = {
  //                cache             worst
  [O.AnIndir]:   [ [2, 0, 0, 0],    [2, 0, 0, 0]  ],
  [O.AnDisp]:    [ [4, 0, 0, 0],    [4, 0, 0, 0]  ],
  [O.PcDisp]:    [ [4, 0, 0, 0],    [4, 0, 0, 0]  ],
  [O.AbsW]:      [ [2, 0, 0, 0],    [2, 0, 0, 0]  ],
  [O.AbsL]:      [ [2, 0, 0, 0],    [2, 0, 0, 0]  ],
  [O.AnDispIx]:  [ [6, 0, 0, 0],    [6, 0, 0, 0]  ],
  [O.PcDispIx]:  [ [6, 0, 0, 0],    [6, 0, 0, 0]  ],
  [O.MemIndir]:  [ [11, 1, 0, 0],   [11, 1, 1, 0] ],
};

// §8.2.2 Fetch Immediate Effective Address (the #.W column). Folded onto the
// source operand of the long mul/div and chk2/cmp2 instructions.
// prettier-ignore
export const fetchImmEa: Partial<Record<AddressingMode, Timing2>> = {
  //                cache             worst
  [O.Dn]:        [ [2, 0, 0, 0],    [3, 0, 1, 0]  ],
  [O.Imm]:       [ [4, 0, 0, 0],    [6, 0, 2, 0]  ],
  [O.AnIndir]:   [ [4, 1, 0, 0],    [4, 1, 1, 0]  ],
  [O.AnPostInc]: [ [6, 1, 0, 0],    [7, 1, 1, 0]  ],
  [O.AnPreDec]:  [ [5, 1, 0, 0],    [6, 1, 1, 0]  ],
  [O.AnDisp]:    [ [5, 1, 0, 0],    [7, 1, 1, 0]  ],
  [O.AbsW]:      [ [5, 1, 0, 0],    [7, 1, 1, 0]  ],
  [O.AbsL]:      [ [6, 1, 0, 0],    [10, 1, 2, 0] ],
};

// §8.2.2 Fetch Immediate Effective Address, the #.L column — for long-immediate
// destinations (e.g. addi.l #x,<mem>).
// prettier-ignore
export const fetchImmEaL: Partial<Record<AddressingMode, Timing2>> = {
  //                cache             worst
  [O.Dn]:        [ [4, 0, 0, 0],    [5, 0, 1, 0]  ],
  [O.AnIndir]:   [ [4, 1, 0, 0],    [7, 1, 1, 0]  ],
  [O.AnPostInc]: [ [8, 1, 0, 0],    [9, 1, 1, 0]  ],
  [O.AnPreDec]:  [ [7, 1, 0, 0],    [8, 1, 1, 0]  ],
  [O.AnDisp]:    [ [7, 1, 0, 0],    [10, 1, 2, 0] ],
  [O.AbsW]:      [ [7, 1, 0, 0],    [10, 1, 2, 0] ],
  [O.AbsL]:      [ [8, 1, 0, 0],    [12, 1, 2, 0] ],
};

// §8.2.4 Calculate Immediate Effective Address (the #.W column). Folded onto the
// memory operand of the memory bit-field instructions and CAS.
// prettier-ignore
export const calcImmEa: Partial<Record<AddressingMode, Timing2>> = {
  //                cache             worst
  [O.Dn]:        [ [2, 0, 0, 0],    [3, 0, 1, 0]  ],
  [O.AnIndir]:   [ [2, 0, 0, 0],    [3, 0, 1, 0]  ],
  [O.AnPostInc]: [ [4, 0, 0, 0],    [5, 0, 1, 0]  ],
  [O.AnPreDec]:  [ [4, 0, 0, 0],    [5, 0, 1, 0]  ],
  [O.AnDisp]:    [ [4, 0, 0, 0],    [5, 0, 1, 0]  ],
  [O.AbsW]:      [ [4, 0, 0, 0],    [5, 0, 1, 0]  ],
  [O.AbsL]:      [ [4, 0, 0, 0],    [6, 0, 2, 0]  ],
};

// prettier-ignore
export const baseTimes: Timing2Row[] = [
  // §8.2.8 Arithmetic/Logical (add fetch EA)
  [ [M.ADD],             [B, W, L], [EA, O.Dn],    [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.ADD],             [B, W, L], [O.Dn, Mem],   [[4, 0, 0, 1],  [6, 0, 1, 1]] ],
  [ [M.SUB],             [B, W, L], [EA, O.Dn],    [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.SUB],             [B, W, L], [O.Dn, Mem],   [[4, 0, 0, 1],  [6, 0, 1, 1]] ],
  [ [M.AND],             [B, W, L], [EA, O.Dn],    [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.AND],             [B, W, L], [O.Dn, Mem],   [[4, 0, 0, 1],  [6, 0, 1, 1]] ],
  [ [M.OR],              [B, W, L], [EA, O.Dn],    [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.OR],              [B, W, L], [O.Dn, Mem],   [[4, 0, 0, 1],  [6, 0, 1, 1]] ],
  [ [M.EOR],             [B, W, L], [O.Dn, O.Dn],  [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.EOR],             [B, W, L], [O.Dn, Mem],   [[4, 0, 0, 1],  [6, 0, 1, 1]] ],
  [ [M.CMP],             [B, W, L], [EA, O.Dn],    [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.ADDA],            [W, L],    [EA, O.An],    [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.SUBA],            [W, L],    [EA, O.An],    [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.CMPA],            [W, L],    [EA, O.An],    [[4, 0, 0, 0],  [4, 0, 1, 0]] ],
  [ [M.MULS, M.MULU],    [W],       [EA, O.Dn],    [[27, 0, 0, 0], [28, 0, 1, 0]] ],
  [ [M.DIVU],            [W],       [EA, O.Dn],    [[44, 0, 0, 0], [44, 0, 1, 0]] ],
  [ [M.DIVS],            [W],       [EA, O.Dn],    [[56, 0, 0, 0], [57, 0, 1, 0]] ],

  // §8.2.9 Immediate arithmetic/logical (quick forms; immediate embedded)
  [ [M.MOVEQ],           [L],       [O.Imm, O.Dn], [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.ADDQ, M.SUBQ],    [B, W, L], [O.Imm, EA],   [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.ADDQ, M.SUBQ],    [B, W, L], [O.Imm, Mem],  [[4, 0, 0, 1],  [6, 0, 1, 1]] ],
  // Immediate arithmetic/logical to a data register (fetch-immediate time,
  // sized by the operand); memory-destination forms not yet included.
  [ [M.ADDI, M.SUBI, M.ANDI, M.ORI, M.EORI, M.CMPI], [B, W], [O.Imm, O.Dn], [[2, 0, 0, 0], [3, 0, 1, 0]] ],
  [ [M.ADDI, M.SUBI, M.ANDI, M.ORI, M.EORI, M.CMPI], [L],    [O.Imm, O.Dn], [[4, 0, 0, 0], [5, 0, 1, 0]] ],
  // Memory destination: read-modify-write base (ALU + writeback) plus the
  // fetch-immediate EA for the destination (word immediates; .L not modelled).
  [ [M.ADDI, M.SUBI, M.ANDI, M.ORI, M.EORI], [B, W], [O.Imm, Mem], [[4, 0, 0, 1], [6, 0, 1, 1]], "fetchImm" ],
  [ [M.ADDI, M.SUBI, M.ANDI, M.ORI, M.EORI], [L],    [O.Imm, Mem], [[4, 0, 0, 1], [6, 0, 1, 1]], "fetchImmL" ],
  // CMPI reads but doesn't write: just the fetch-immediate EA of the operand.
  [ [M.CMPI],            [B, W],    [O.Imm, Mem],  [[0, 0, 0, 0],  [0, 0, 0, 0]], "fetchImm" ],
  [ [M.CMPI],            [L],       [O.Imm, Mem],  [[0, 0, 0, 0],  [0, 0, 0, 0]], "fetchImmL" ],

  // §8.2.11 Single-operand
  [ [M.CLR],             [B, W, L], [O.Dn],        [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.CLR],             [B, W, L], [Mem],         [[4, 0, 0, 1],  [6, 0, 1, 1]], "calc" ],
  [ [M.NEG, M.NEGX, M.NOT], [B, W, L], [O.Dn],     [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.NEG, M.NEGX, M.NOT], [B, W, L], [Mem],      [[4, 0, 0, 1],  [6, 0, 1, 1]] ],
  [ [M.EXT],             [W, L],    [O.Dn],        [[4, 0, 0, 0],  [4, 0, 1, 0]] ],
  [ [M.NBCD],            [B],       [O.Dn],        [[6, 0, 0, 0],  [6, 0, 1, 0]] ],
  [ SCC,                 [B],       [O.Dn],        [[4, 0, 0, 0],  [4, 0, 1, 0]] ],
  [ SCC,                 [B],       [Mem],         [[6, 0, 0, 1],  [6, 0, 1, 1]], "calc" ],
  [ [M.TAS],             [B],       [O.Dn],        [[4, 0, 0, 0],  [4, 0, 1, 0]] ],
  [ [M.TAS],             [B],       [Mem],         [[12, 1, 0, 1], [13, 1, 1, 1]], "calc" ],
  [ [M.TST],             [B, W, L], [EA],          [[2, 0, 0, 0],  [3, 0, 1, 0]] ],

  // §8.2.12 Shift/rotate (bit count does not affect timing)
  [ [M.LSL, M.LSR],      [B, W, L], [O.Imm, O.Dn], [[4, 0, 0, 0],  [4, 0, 1, 0]] ],
  [ [M.LSL, M.LSR],      [B, W, L], [O.Dn, O.Dn],  [[6, 0, 0, 0],  [6, 0, 1, 0]] ],
  [ [M.ASL],             [B, W, L], [O.Imm, O.Dn], [[8, 0, 0, 0],  [8, 0, 1, 0]] ],
  [ [M.ASL],             [B, W, L], [O.Dn, O.Dn],  [[8, 0, 0, 0],  [8, 0, 1, 0]] ],
  [ [M.ASR],             [B, W, L], [O.Imm, O.Dn], [[6, 0, 0, 0],  [6, 0, 1, 0]] ],
  [ [M.ASR],             [B, W, L], [O.Dn, O.Dn],  [[6, 0, 0, 0],  [6, 0, 1, 0]] ],
  [ [M.ROL, M.ROR],      [B, W, L], [O.Imm, O.Dn], [[8, 0, 0, 0],  [8, 0, 1, 0]] ],
  [ [M.ROL, M.ROR],      [B, W, L], [O.Dn, O.Dn],  [[8, 0, 0, 0],  [8, 0, 1, 0]] ],
  [ [M.ROXL, M.ROXR],    [B, W, L], [O.Imm, O.Dn], [[12, 0, 0, 0], [12, 0, 1, 0]] ],
  [ [M.ROXL, M.ROXR],    [B, W, L], [O.Dn, O.Dn],  [[12, 0, 0, 0], [12, 0, 1, 0]] ],
  [ [M.LSL, M.LSR],      [W],       [Mem],         [[5, 0, 0, 1],  [6, 0, 1, 1]] ],
  [ [M.ASL],             [W],       [Mem],         [[6, 0, 0, 1],  [7, 0, 1, 1]] ],
  [ [M.ASR],             [W],       [Mem],         [[5, 0, 0, 1],  [6, 0, 1, 1]] ],
  [ [M.ROL, M.ROR],      [W],       [Mem],         [[7, 0, 0, 1],  [7, 0, 1, 1]] ],
  [ [M.ROXL, M.ROXR],    [W],       [Mem],         [[5, 0, 0, 1],  [6, 0, 1, 1]] ],

  // §8.2.10 Binary-coded decimal / extended
  [ [M.ABCD, M.SBCD],    [B],       [O.Dn, O.Dn],  [[4, 0, 0, 0],  [5, 0, 1, 0]] ],
  [ [M.ABCD, M.SBCD],    [B],       [O.AnPreDec, O.AnPreDec], [[16, 2, 0, 1], [17, 2, 1, 1]] ],
  [ [M.ADDX, M.SUBX],    [B, W, L], [O.Dn, O.Dn],  [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.ADDX, M.SUBX],    [B, W, L], [O.AnPreDec, O.AnPreDec], [[12, 2, 0, 1], [13, 2, 1, 1]] ],
  [ [M.CMPM],            [B, W, L], [O.AnPostInc, O.AnPostInc], [[9, 2, 0, 0], [10, 2, 1, 0]] ],
  [ [M.PACK],            [null],    [O.Dn, O.Dn, O.Imm],       [[6, 0, 0, 0],  [7, 0, 1, 0]] ],
  [ [M.PACK],            [null],    [O.AnPreDec, O.AnPreDec, O.Imm], [[13, 1, 0, 1], [13, 1, 1, 1]] ],
  [ [M.UNPK],            [null],    [O.Dn, O.Dn, O.Imm],       [[8, 0, 0, 0],  [9, 0, 1, 0]] ],
  [ [M.UNPK],            [null],    [O.AnPreDec, O.AnPreDec, O.Imm], [[13, 1, 0, 1], [13, 1, 1, 1]] ],

  // §8.2.13 Bit manipulation (register + Dn,Mem forms; #,Mem not included)
  [ [M.BTST, M.BCHG, M.BCLR, M.BSET], [L], [O.Imm, O.Dn], [[4, 0, 0, 0], [5, 0, 1, 0]] ],
  [ [M.BTST, M.BCHG, M.BCLR, M.BSET], [L], [O.Dn, O.Dn],  [[4, 0, 0, 0], [5, 0, 1, 0]] ],
  [ [M.BTST],            [B],       [O.Dn, Mem],   [[4, 0, 0, 0],  [5, 0, 1, 0]] ],
  [ [M.BCHG, M.BCLR, M.BSET], [B],  [O.Dn, Mem],   [[4, 0, 0, 1],  [5, 0, 1, 1]] ],
  // Immediate bit number to memory (adds fetch-immediate EA for the operand).
  [ [M.BTST],            [B],       [O.Imm, Mem],  [[4, 0, 0, 0],  [5, 0, 1, 0]], "fetchImm" ],
  [ [M.BCHG, M.BCLR, M.BSET], [B],  [O.Imm, Mem],  [[4, 0, 0, 1],  [5, 0, 1, 1]], "fetchImm" ],

  // §8.2.15 Conditional branch. Outcomes: taken, not-taken (Bcc); taken,
  // not-taken, expired (DBcc). Not-taken cost depends on the branch size.
  [ BCC,                 [B],       [O.AbsL], [[[6, 0, 0, 0], [9, 0, 2, 0]], [[4, 0, 0, 0], [5, 0, 1, 0]]] ],
  [ BCC,                 [W],       [O.AbsL], [[[6, 0, 0, 0], [9, 0, 2, 0]], [[6, 0, 0, 0], [7, 0, 1, 0]]] ],
  [ BCC,                 [L],       [O.AbsL], [[[6, 0, 0, 0], [9, 0, 2, 0]], [[6, 0, 0, 0], [9, 0, 2, 0]]] ],
  [ [M.BRA],             [B, W, L], [O.AbsL],      [[6, 0, 0, 0],  [9, 0, 2, 0]] ],
  [ [M.BSR],             [B, W, L], [O.AbsL],      [[7, 0, 0, 1],  [13, 0, 2, 1]] ],
  [ DBCC,                [W],       [O.Dn, O.AbsL], [[[6, 0, 0, 0], [9, 0, 2, 0]], [[6, 0, 0, 0], [7, 0, 1, 0]], [[10, 0, 0, 0], [10, 0, 3, 0]]] ],

  // §8.2.16 Control
  [ [M.ANDI, M.EORI, M.ORI], [W],   [O.Imm, O.SR], [[12, 0, 0, 0], [15, 0, 2, 0]] ],
  [ [M.ANDI, M.EORI, M.ORI], [B],   [O.Imm, O.CCR], [[12, 0, 0, 0], [15, 0, 2, 0]] ],
  [ [M.CHK],             [W, L],    [EA, O.Dn],    [[8, 0, 0, 0],  [8, 0, 1, 0]] ],
  [ [M.LEA],             [L],       [Mem, O.An],   [[2, 0, 0, 0],  [3, 0, 1, 0]], "calc" ],
  [ [M.PEA],             [L],       [Mem],         [[5, 0, 0, 1],  [6, 0, 1, 1]], "calc" ],
  [ [M.JMP],             [null],    [Mem],         [[4, 0, 0, 0],  [7, 0, 2, 0]], "jump" ],
  [ [M.JSR],             [null],    [Mem],         [[5, 0, 0, 1],  [11, 0, 2, 1]], "jump" ],
  [ [M.LINK],            [W],       [O.An, O.Imm], [[5, 0, 0, 1],  [7, 0, 1, 1]] ],
  [ [M.LINK],            [L],       [O.An, O.Imm], [[6, 0, 0, 1],  [10, 0, 2, 1]] ],
  [ [M.UNLK],            [null],    [O.An],        [[6, 1, 0, 0],  [7, 1, 1, 0]] ],
  [ [M.NOP],             [null],    [],            [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.RTD],             [null],    [O.Imm],       [[10, 1, 0, 0], [12, 1, 2, 0]] ],
  [ [M.RTR],             [null],    [],            [[14, 2, 0, 0], [15, 2, 2, 0]] ],
  [ [M.RTS],             [null],    [],            [[10, 1, 0, 0], [12, 1, 2, 0]] ],

  // §8.2.7 Special-purpose MOVE
  [ [M.EXG],             [L],       [O.Dn, O.Dn],  [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.EXG],             [L],       [O.An, O.An],  [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.EXG],             [L],       [O.Dn, O.An],  [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.SWAP],            [W],       [O.Dn],        [[4, 0, 0, 0],  [4, 0, 1, 0]] ],
  [ [M.MOVE],            [W],       [O.SR, O.Dn],  [[4, 0, 0, 0],  [5, 0, 1, 0]] ],
  [ [M.MOVE],            [W],       [O.SR, Mem],   [[5, 0, 0, 1],  [7, 0, 1, 1]], "calc" ],
  [ [M.MOVE],            [W],       [EA, O.CCR],   [[4, 0, 0, 0],  [5, 0, 1, 0]] ],
  [ [M.MOVE],            [W],       [EA, O.SR],    [[8, 0, 0, 0],  [11, 0, 2, 0]] ],
  [ [M.MOVE],            [W, L],    [O.USP, O.An], [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.MOVE],            [W, L],    [O.An, O.USP], [[2, 0, 0, 0],  [3, 0, 1, 0]] ],
  [ [M.MOVEP],           [W],       [O.Dn, O.AnDisp], [[11, 0, 0, 2], [11, 0, 1, 2]] ],
  [ [M.MOVEP],           [L],       [O.Dn, O.AnDisp], [[17, 0, 0, 4], [17, 0, 1, 4]] ],
  [ [M.MOVEP],           [W],       [O.AnDisp, O.Dn], [[12, 2, 0, 0], [12, 2, 1, 0]] ],
  [ [M.MOVEP],           [L],       [O.AnDisp, O.Dn], [[18, 4, 0, 0], [18, 4, 1, 0]] ],
  // movec: control register <-> Rn (the control register parses as an absolute)
  [ [M.MOVEC],           [null],    [O.AbsL, O.Dn], [[6, 0, 0, 0],  [7, 0, 1, 0]] ],
  [ [M.MOVEC],           [null],    [O.AbsL, O.An], [[6, 0, 0, 0],  [7, 0, 1, 0]] ],
  [ [M.MOVEC],           [null],    [O.Dn, O.AbsL], [[12, 0, 0, 0], [13, 0, 1, 0]] ],
  [ [M.MOVEC],           [null],    [O.An, O.AbsL], [[12, 0, 0, 0], [13, 0, 1, 0]] ],
  // moves: register <-> alternate address space (add calculate-immediate EA)
  [ [M.MOVES],           [B, W, L], [Mem, O.Dn],   [[7, 1, 0, 0],  [8, 1, 1, 0]], "calcImm" ],
  [ [M.MOVES],           [B, W, L], [Mem, O.An],   [[7, 1, 0, 0],  [8, 1, 1, 0]], "calcImm" ],
  [ [M.MOVES],           [B, W, L], [O.Dn, Mem],   [[5, 0, 0, 1],  [7, 0, 1, 1]], "calcImm" ],
  [ [M.MOVES],           [B, W, L], [O.An, Mem],   [[5, 0, 0, 1],  [7, 0, 1, 1]], "calcImm" ],

  // §8.2.17 Exception-related
  [ [M.BKPT],            [null],    [O.Imm],       [[10, 1, 0, 0], [10, 1, 0, 0]] ],
  [ [M.STOP],            [null],    [O.Imm],       [[8, 0, 0, 0],  [8, 0, 0, 0]] ],
  [ [M.TRAP],            [null],    [O.Imm],       [[20, 1, 0, 4], [27, 1, 2, 4]] ],
  [ [M.ILLEGAL],         [null],    [],            [[20, 1, 0, 4], [27, 1, 2, 4]] ],
  // Outcomes: no-trap, trap
  [ [M.TRAPV],           [null],    [], [[[4, 0, 0, 0], [5, 0, 1, 0]], [[25, 1, 0, 5], [32, 1, 2, 5]]] ],
  [ [M.RESET],           [null],    [],            [[518, 0, 0, 0], [519, 0, 1, 0]] ],

  // §8.2.7 MOVEM: base + 4n (load, per register read) or + 3n (store, per
  // register write). Small calculate-immediate EA term for the memory operand
  // is omitted.
  [ [M.MOVEM], [W, L], [O.RegList, O.AnPreDec], [[4, 0, 0, 0], [5, 0, 1, 0]], undefined, [3, 0, 0, 1] ],
  [ [M.MOVEM], [W, L], [O.RegList, O.AnIndir],  [[4, 0, 0, 0], [5, 0, 1, 0]], undefined, [3, 0, 0, 1] ],
  [ [M.MOVEM], [W, L], [O.RegList, O.AnDisp],   [[4, 0, 0, 0], [5, 0, 1, 0]], undefined, [3, 0, 0, 1] ],
  [ [M.MOVEM], [W, L], [O.RegList, O.AbsW],     [[4, 0, 0, 0], [5, 0, 1, 0]], undefined, [3, 0, 0, 1] ],
  [ [M.MOVEM], [W, L], [O.RegList, O.AbsL],     [[4, 0, 0, 0], [5, 0, 1, 0]], undefined, [3, 0, 0, 1] ],
  [ [M.MOVEM], [W, L], [O.AnPostInc, O.RegList], [[8, 0, 0, 0], [9, 0, 1, 0]], undefined, [4, 1, 0, 0] ],
  [ [M.MOVEM], [W, L], [O.AnIndir, O.RegList],  [[8, 0, 0, 0], [9, 0, 1, 0]], undefined, [4, 1, 0, 0] ],
  [ [M.MOVEM], [W, L], [O.AnDisp, O.RegList],   [[8, 0, 0, 0], [9, 0, 1, 0]], undefined, [4, 1, 0, 0] ],
  [ [M.MOVEM], [W, L], [O.PcDisp, O.RegList],   [[8, 0, 0, 0], [9, 0, 1, 0]], undefined, [4, 1, 0, 0] ],
  [ [M.MOVEM], [W, L], [O.AbsW, O.RegList],     [[8, 0, 0, 0], [9, 0, 1, 0]], undefined, [4, 1, 0, 0] ],
  [ [M.MOVEM], [W, L], [O.AbsL, O.RegList],     [[8, 0, 0, 0], [9, 0, 1, 0]], undefined, [4, 1, 0, 0] ],

  // §8.2.8 Long multiply/divide and chk2/cmp2 (add fetch-immediate EA on source)
  [ [M.MULS, M.MULU],    [L],       [EA, O.Dn],    [[43, 0, 0, 0], [44, 0, 1, 0]], "fetchImm" ],
  [ [M.DIVU, M.DIVUL],   [L],       [EA, O.Dn],    [[78, 0, 0, 0], [79, 0, 1, 0]], "fetchImm" ],
  [ [M.DIVS, M.DIVSL],   [L],       [EA, O.Dn],    [[90, 0, 0, 0], [91, 0, 1, 0]], "fetchImm" ],
  [ [M.CHK2],            [B, W, L], [EA, O.Dn],    [[18, 2, 0, 0], [18, 2, 1, 0]], "fetchImm" ],
  [ [M.CMP2],            [B, W, L], [EA, O.Dn],    [[18, 1, 0, 0], [18, 1, 1, 0]], "fetchImm" ],

  // §8.2.16 CAS / CAS2. Outcomes: unsuccessful compare, successful compare.
  // CAS adds calculate-immediate EA for its memory operand.
  [ [M.CAS],             [B, W, L], [O.Dn, O.Dn, Mem], [[[12, 1, 0, 0], [13, 1, 1, 0]], [[15, 1, 0, 1], [16, 1, 1, 1]]], "calcImm" ],
  [ [M.CAS2],            [B, W, L], [O.Dn, O.Dn, O.Dn], [[[22, 2, 0, 0], [25, 2, 2, 0]], [[25, 2, 0, 2], [28, 2, 2, 2]]] ],

  // §8.2.14 Bit field (register self-contained; memory adds calc-imm EA, <5-byte span)
  [ [M.BFTST],           [null],    [O.Dn],        [[6, 0, 0, 0],  [7, 0, 1, 0]] ],
  [ [M.BFTST],           [null],    [Mem],         [[11, 1, 0, 0], [12, 1, 1, 0]], "calcImm" ],
  [ [M.BFCHG, M.BFCLR, M.BFSET], [null], [O.Dn],   [[12, 0, 0, 0], [12, 0, 1, 0]] ],
  [ [M.BFCHG, M.BFCLR, M.BFSET], [null], [Mem],    [[16, 1, 0, 1], [16, 1, 1, 1]], "calcImm" ],
  [ [M.BFEXTS, M.BFEXTU], [null],   [O.Dn, O.Dn],  [[8, 0, 0, 0],  [8, 0, 1, 0]] ],
  [ [M.BFEXTS, M.BFEXTU], [null],   [Mem, O.Dn],   [[13, 1, 0, 0], [13, 1, 1, 0]], "calcImm" ],
  [ [M.BFFFO],           [null],    [O.Dn, O.Dn],  [[18, 0, 0, 0], [18, 0, 1, 0]] ],
  [ [M.BFFFO],           [null],    [Mem, O.Dn],   [[24, 1, 0, 0], [24, 1, 1, 0]], "calcImm" ],
  [ [M.BFINS],           [null],    [O.Dn, O.Dn],  [[10, 0, 0, 0], [10, 0, 1, 0]] ],
  [ [M.BFINS],           [null],    [O.Dn, Mem],   [[14, 1, 0, 1], [15, 1, 1, 1]], "calcImm" ],
];

// §8.2.6 MOVE — a self-contained source×dest matrix (no EA time is added).
// Operand size only affects immediate-source moves on the 68020, so byte/word/
// long share these values. Immediate sources are omitted for now. MOVE to An is
// also keyed as MOVEA.
// prettier-ignore
export const moveTimes: Timing2Row[] = [
  // Immediate source (worst case reconstructed: the manual's printed
  // immediate worst-case row is a transcription error duplicating the
  // register-source row, so worst = reliable cache + register cache->worst delta).
  [ [M.MOVE, M.MOVEA], [W], [O.Imm, O.An], [[4, 0, 0, 0], [5, 0, 1, 0]] ],
  [ [M.MOVE], [B, W], [O.Imm, O.Dn], [[4, 0, 0, 0], [5, 0, 1, 0]] ],
  [ [M.MOVE], [B, W], [O.Imm, O.AnIndir], [[6, 0, 0, 1], [7, 0, 1, 0]] ],
  [ [M.MOVE], [B, W], [O.Imm, O.AnPostInc], [[6, 0, 0, 1], [7, 0, 1, 1]] ],
  [ [M.MOVE], [B, W], [O.Imm, O.AnPreDec], [[7, 0, 0, 1], [8, 0, 1, 1]] ],
  [ [M.MOVE], [B, W], [O.Imm, O.AnDisp], [[7, 0, 0, 1], [9, 0, 1, 1]] ],
  [ [M.MOVE], [B, W], [O.Imm, O.AbsW], [[6, 0, 0, 1], [9, 0, 1, 1]] ],
  [ [M.MOVE], [B, W], [O.Imm, O.AbsL], [[8, 0, 0, 1], [11, 0, 2, 1]] ],
  [ [M.MOVE, M.MOVEA], [L], [O.Imm, O.An], [[6, 0, 0, 0], [7, 0, 1, 0]] ],
  [ [M.MOVE], [L], [O.Imm, O.Dn], [[6, 0, 0, 0], [7, 0, 1, 0]] ],
  [ [M.MOVE], [L], [O.Imm, O.AnIndir], [[8, 0, 0, 1], [9, 0, 1, 0]] ],
  [ [M.MOVE], [L], [O.Imm, O.AnPostInc], [[8, 0, 0, 1], [9, 0, 1, 1]] ],
  [ [M.MOVE], [L], [O.Imm, O.AnPreDec], [[9, 0, 0, 1], [10, 0, 1, 1]] ],
  [ [M.MOVE], [L], [O.Imm, O.AnDisp], [[9, 0, 0, 1], [11, 0, 1, 1]] ],
  [ [M.MOVE], [L], [O.Imm, O.AbsW], [[8, 0, 0, 1], [11, 0, 1, 1]] ],
  [ [M.MOVE], [L], [O.Imm, O.AbsL], [[10, 0, 0, 1], [13, 0, 2, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.Dn, O.An], [[2, 0, 0, 0], [3, 0, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.Dn, O.Dn], [[2, 0, 0, 0], [3, 0, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.Dn, O.AnIndir], [[4, 0, 0, 1], [5, 0, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.Dn, O.AnPostInc], [[4, 0, 0, 1], [5, 0, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.Dn, O.AnPreDec], [[5, 0, 0, 1], [6, 0, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.Dn, O.AnDisp], [[5, 0, 0, 1], [7, 0, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.Dn, O.AbsW], [[4, 0, 0, 1], [7, 0, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.Dn, O.AbsL], [[6, 0, 0, 1], [9, 0, 2, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.An, O.An], [[2, 0, 0, 0], [3, 0, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.An, O.Dn], [[2, 0, 0, 0], [3, 0, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.An, O.AnIndir], [[4, 0, 0, 1], [5, 0, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.An, O.AnPostInc], [[4, 0, 0, 1], [5, 0, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.An, O.AnPreDec], [[5, 0, 0, 1], [6, 0, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.An, O.AnDisp], [[5, 0, 0, 1], [7, 0, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.An, O.AbsW], [[4, 0, 0, 1], [7, 0, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.An, O.AbsL], [[6, 0, 0, 1], [9, 0, 2, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.AnIndir, O.An], [[6, 1, 0, 0], [7, 1, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnIndir, O.Dn], [[6, 1, 0, 0], [7, 1, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnIndir, O.AnIndir], [[7, 1, 0, 1], [9, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnIndir, O.AnPostInc], [[7, 1, 0, 1], [9, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnIndir, O.AnPreDec], [[7, 1, 0, 1], [9, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnIndir, O.AnDisp], [[7, 1, 0, 1], [11, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnIndir, O.AbsW], [[7, 1, 0, 1], [11, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnIndir, O.AbsL], [[9, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.AnPostInc, O.An], [[6, 1, 0, 0], [7, 1, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnPostInc, O.Dn], [[6, 1, 0, 0], [7, 1, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnPostInc, O.AnIndir], [[7, 1, 0, 1], [9, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPostInc, O.AnPostInc], [[7, 1, 0, 1], [9, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPostInc, O.AnPreDec], [[7, 1, 0, 1], [9, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPostInc, O.AnDisp], [[7, 1, 0, 1], [11, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPostInc, O.AbsW], [[7, 1, 0, 1], [11, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPostInc, O.AbsL], [[9, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.AnPreDec, O.An], [[7, 1, 0, 0], [8, 1, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnPreDec, O.Dn], [[7, 1, 0, 0], [8, 1, 1, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnPreDec, O.AnIndir], [[8, 1, 0, 1], [10, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPreDec, O.AnPostInc], [[8, 1, 0, 1], [10, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPreDec, O.AnPreDec], [[8, 1, 0, 1], [10, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPreDec, O.AnDisp], [[8, 1, 0, 1], [12, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPreDec, O.AbsW], [[8, 1, 0, 1], [12, 1, 1, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnPreDec, O.AbsL], [[10, 1, 0, 1], [14, 1, 2, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.AnDisp, O.An], [[7, 1, 0, 0], [9, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnDisp, O.Dn], [[7, 1, 0, 0], [9, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnDisp, O.AnIndir], [[8, 1, 0, 1], [11, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDisp, O.AnPostInc], [[8, 1, 0, 1], [11, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDisp, O.AnPreDec], [[8, 1, 0, 1], [11, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDisp, O.AnDisp], [[8, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDisp, O.AbsW], [[8, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDisp, O.AbsL], [[10, 1, 0, 1], [15, 1, 3, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.PcDisp, O.An], [[7, 1, 0, 0], [9, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.PcDisp, O.Dn], [[7, 1, 0, 0], [9, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.PcDisp, O.AnIndir], [[8, 1, 0, 1], [11, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDisp, O.AnPostInc], [[8, 1, 0, 1], [11, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDisp, O.AnPreDec], [[8, 1, 0, 1], [11, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDisp, O.AnDisp], [[8, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDisp, O.AbsW], [[8, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDisp, O.AbsL], [[10, 1, 0, 1], [15, 1, 3, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.AbsW, O.An], [[6, 1, 0, 0], [8, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AbsW, O.Dn], [[6, 1, 0, 0], [8, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AbsW, O.AnIndir], [[7, 1, 0, 1], [10, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsW, O.AnPostInc], [[7, 1, 0, 1], [10, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsW, O.AnPreDec], [[7, 1, 0, 1], [10, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsW, O.AnDisp], [[7, 1, 0, 1], [12, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsW, O.AbsW], [[7, 1, 0, 1], [12, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsW, O.AbsL], [[9, 1, 0, 1], [14, 1, 3, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.AbsL, O.An], [[6, 1, 0, 0], [10, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AbsL, O.Dn], [[6, 1, 0, 0], [10, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AbsL, O.AnIndir], [[7, 1, 0, 1], [12, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsL, O.AnPostInc], [[7, 1, 0, 1], [12, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsL, O.AnPreDec], [[7, 1, 0, 1], [12, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsL, O.AnDisp], [[7, 1, 0, 1], [14, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsL, O.AbsW], [[7, 1, 0, 1], [14, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AbsL, O.AbsL], [[9, 1, 0, 1], [16, 1, 3, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.AnDispIx, O.An], [[9, 1, 0, 0], [11, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnDispIx, O.Dn], [[9, 1, 0, 0], [11, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.AnDispIx, O.AnIndir], [[10, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDispIx, O.AnPostInc], [[10, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDispIx, O.AnPreDec], [[10, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDispIx, O.AnDisp], [[10, 1, 0, 1], [15, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDispIx, O.AbsW], [[10, 1, 0, 1], [15, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.AnDispIx, O.AbsL], [[12, 1, 0, 1], [17, 1, 3, 1]] ],
  [ [M.MOVE, M.MOVEA], [W, L], [O.PcDispIx, O.An], [[9, 1, 0, 0], [11, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.PcDispIx, O.Dn], [[9, 1, 0, 0], [11, 1, 2, 0]] ],
  [ [M.MOVE], [B, W, L], [O.PcDispIx, O.AnIndir], [[10, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDispIx, O.AnPostInc], [[10, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDispIx, O.AnPreDec], [[10, 1, 0, 1], [13, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDispIx, O.AnDisp], [[10, 1, 0, 1], [15, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDispIx, O.AbsW], [[10, 1, 0, 1], [15, 1, 2, 1]] ],
  [ [M.MOVE], [B, W, L], [O.PcDispIx, O.AbsL], [[12, 1, 0, 1], [17, 1, 3, 1]] ],
];
