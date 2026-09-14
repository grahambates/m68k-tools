import {
  AddressingModes as O,
  Qualifiers,
  Mnemonics as M,
  mnemonicGroups,
  type AddressingMode,
} from "../syntax";
import type { Timing2, Timing2Row } from "./tables68020";

/**
 * MC68030 User's Manual §11.6, pp. 11-26–11-50:
 * https://www.nxp.com/docs/en/reference-manual/MC68030UM-P2.pdf
 * [clocks, operand reads, instruction prefetches, writes], I-cache / no-cache.
 * Two-clock reads/writes, aligned operands and no inter-instruction overlap.
 * No-cache is the manual's average estimate, NOT an absolute worst case.
 * Head/tail overlap, data-cache hits, MMU walks and wait states are not simulated.
 * Full-format and memory-indirect costs are resolved from parsed operands in
 * ea68030.ts; these tables provide the ordinary operation and EA costs.
 */
const { B, W, L } = Qualifiers;
const { SCC, BCC, DBCC } = mnemonicGroups;
type EaTable = Partial<Record<AddressingMode, Timing2>>;
const pair = (
  cache: number,
  uncached = cache,
  reads = 0,
  prefetch = 1,
  writes = 0,
): Timing2 => [
  [cache, reads, 0, writes],
  [uncached, reads, prefetch, writes],
];
const Mem = [
  O.AnIndir,
  O.AnPostInc,
  O.AnPreDec,
  O.AnDisp,
  O.AnDispIx,
  O.AbsW,
  O.AbsL,
];
const Control = [
  O.AnIndir,
  O.AnDisp,
  O.AnDispIx,
  O.PcDisp,
  O.PcDispIx,
  O.AbsW,
  O.AbsL,
];
const ReadMem = [...Mem, O.PcDisp, O.PcDispIx];
const EA = [O.Dn, O.An, ...ReadMem, O.Imm];

// §11.6.1: single-EA and brief-extension forms only.
export const fetchEa: EaTable = {
  [O.Dn]: pair(0, 0, 0, 0),
  [O.An]: pair(0, 0, 0, 0),
  [O.AnIndir]: pair(3, 3, 1, 0),
  [O.AnPostInc]: pair(3, 3, 1, 0),
  [O.AnPreDec]: pair(4, 4, 1, 0),
  [O.AnDisp]: pair(4, 4, 1),
  [O.PcDisp]: pair(4, 4, 1),
  [O.AbsW]: pair(4, 4, 1),
  [O.AbsL]: pair(4, 5, 1),
  [O.AnDispIx]: pair(6, 6, 1),
  [O.PcDispIx]: pair(6, 6, 1),
  [O.Imm]: pair(2),
};
export const fetchEaLong: EaTable = { ...fetchEa, [O.Imm]: pair(4) };
// §11.6.2: immediate-source operations; long immediates have a separate table.
export const fetchImmEa: EaTable = {
  [O.Dn]: pair(2),
  [O.An]: pair(2),
  [O.Imm]: pair(4, 4, 0, 2),
  [O.AnIndir]: pair(3, 4, 1),
  [O.AnPostInc]: pair(5, 5, 1),
  [O.AnPreDec]: pair(4, 4, 1),
  [O.AnDisp]: pair(4, 5, 1),
  [O.PcDisp]: pair(4, 5, 1),
  [O.AbsW]: pair(6, 6, 1),
  [O.AbsL]: pair(6, 7, 1, 2),
  [O.AnDispIx]: pair(8, 8, 1, 2),
  [O.PcDispIx]: pair(8, 8, 1, 2),
};
export const fetchImmEaL: EaTable = {
  [O.Dn]: pair(4),
  [O.An]: pair(4),
  [O.AnIndir]: pair(4, 5, 1),
  [O.AnPostInc]: pair(7, 7, 1),
  [O.AnPreDec]: pair(4, 5, 1),
  [O.AnDisp]: pair(6, 8, 1, 2),
  [O.PcDisp]: pair(6, 8, 1, 2),
  [O.AbsW]: pair(8, 8, 1, 2),
  [O.AbsL]: pair(8, 9, 1, 2),
  [O.AnDispIx]: pair(10, 10, 1, 2),
  [O.PcDispIx]: pair(10, 10, 1, 2),
};
// §11.6.3–4. The HTML transcription incorrectly drops AnDisp's prefetch.
export const calcEa: EaTable = {
  [O.Dn]: pair(0, 0, 0, 0),
  [O.An]: pair(0, 0, 0, 0),
  [O.AnIndir]: pair(2, 2, 0, 0),
  [O.AnPostInc]: pair(2, 2, 0, 0),
  [O.AnPreDec]: pair(2, 2, 0, 0),
  [O.AnDisp]: pair(2),
  [O.PcDisp]: pair(2),
  [O.AbsW]: pair(2),
  [O.AbsL]: pair(4),
  [O.AnDispIx]: pair(4),
  [O.PcDispIx]: pair(4),
};
export const calcImmEa: EaTable = {
  [O.Dn]: pair(2),
  [O.An]: pair(2),
  [O.AnIndir]: pair(2),
  [O.AnPostInc]: pair(4),
  [O.AnPreDec]: pair(2),
  [O.AnDisp]: pair(4),
  [O.PcDisp]: pair(4),
  [O.AbsW]: pair(4),
  [O.AbsL]: pair(6, 6, 0, 2),
  [O.AnDispIx]: pair(6, 6, 0, 2),
  [O.PcDispIx]: pair(6, 6, 0, 2),
};
// §11.6.5. Plain (An) has no additional EA term; displacement/absolute add 2.
export const jumpEa: EaTable = {
  [O.AnIndir]: pair(0, 0, 0, 0),
  [O.AnDisp]: pair(2, 2, 0, 0),
  [O.PcDisp]: pair(2, 2, 0, 0),
  [O.AbsW]: pair(2, 2, 0, 0),
  [O.AbsL]: pair(2, 2, 0, 0),
  [O.AnDispIx]: pair(6, 6, 0, 0),
  [O.PcDispIx]: pair(6, 6, 0, 0),
};

// Operation costs exclude the specified EA term. Max-data-dependent multiply/
// divide costs are used, as documented in §11.6.8; no 68000 multipliers apply.
export const baseTimes: Timing2Row[] = [
  [[M.ADD, M.SUB, M.AND, M.OR, M.CMP], [B, W, L], [EA, O.Dn], pair(2)],
  [
    [M.ADD, M.SUB, M.AND, M.OR, M.EOR],
    [B, W, L],
    [O.Dn, Mem],
    pair(3, 4, 0, 1, 1),
  ],
  [[M.EOR], [B, W, L], [O.Dn, O.Dn], pair(2)],
  [[M.ADDA, M.SUBA], [W], [EA, O.An], pair(4)],
  [[M.ADDA, M.SUBA], [L], [EA, O.An], pair(2)],
  [[M.CMPA], [W, L], [EA, O.An], pair(4)],
  [[M.MULS, M.MULU], [W], [EA, O.Dn], pair(28)],
  [[M.MULS, M.MULU], [L], [EA, O.Dn], pair(44), "fetchImm"],
  [[M.DIVS], [W], [EA, O.Dn], pair(56)],
  [[M.DIVU], [W], [EA, O.Dn], pair(44)],
  [[M.DIVS, M.DIVSL], [L], [EA, O.Dn], pair(90), "fetchImm"],
  [[M.DIVU, M.DIVUL], [L], [EA, O.Dn], pair(78), "fetchImm"],
  [[M.MOVEQ], [L], [O.Imm, O.Dn], pair(2)],
  [[M.ADDQ, M.SUBQ], [B, W, L], [O.Imm, O.Dn], pair(2)],
  [[M.ADDQ, M.SUBQ], [W, L], [O.Imm, O.An], pair(2)],
  [[M.ADDQ, M.SUBQ], [B, W, L], [O.Imm, Mem], pair(3, 4, 0, 1, 1)],
  [
    [M.ADDI, M.SUBI, M.ANDI, M.ORI, M.EORI, M.CMPI],
    [B, W],
    [O.Imm, O.Dn],
    pair(4, 4, 0, 2),
  ],
  [
    [M.ADDI, M.SUBI, M.ANDI, M.ORI, M.EORI, M.CMPI],
    [L],
    [O.Imm, O.Dn],
    pair(6, 6, 0, 2),
  ],
  [
    [M.ADDI, M.SUBI, M.ANDI, M.ORI, M.EORI],
    [B, W],
    [O.Imm, Mem],
    pair(3, 4, 0, 1, 1),
    "fetchImm",
  ],
  [
    [M.ADDI, M.SUBI, M.ANDI, M.ORI, M.EORI],
    [L],
    [O.Imm, Mem],
    pair(3, 4, 0, 1, 1),
    "fetchImmL",
  ],
  [[M.CMPI], [B, W], [O.Imm, Mem], pair(2), "fetchImm"],
  [[M.CMPI], [L], [O.Imm, Mem], pair(2), "fetchImmL"],
  [[M.CLR, M.NEG, M.NEGX, M.NOT], [B, W, L], [O.Dn], pair(2)],
  [[M.CLR], [B, W, L], [Mem], pair(3, 4, 0, 1, 1), "calc"],
  [[M.NEG, M.NEGX, M.NOT], [B, W, L], [Mem], pair(3, 4, 0, 1, 1)],
  [[M.EXT], [W, L], [O.Dn], pair(4)],
  [[M.EXTB], [L], [O.Dn], pair(4)],
  [[M.NBCD], [B], [O.Dn], pair(6)],
  [SCC, [B], [O.Dn], pair(4)],
  [SCC, [B], [Mem], pair(5, 5, 0, 1, 1), "calc"],
  [[M.TAS], [B], [O.Dn], pair(4)],
  [[M.TAS], [B], [Mem], pair(12, 12, 1, 1, 1), "calc"],
  [[M.TST], [B, W, L], [EA], pair(2)],
  [[M.LSL, M.LSR, M.ASR], [B, W, L], [O.Imm, O.Dn], pair(4)],
  [
    [M.LSL, M.LSR],
    [B, W, L],
    [O.Dn, O.Dn],
    [pair(6), pair(8)],
  ],
  [[M.ASR], [B, W, L], [O.Dn, O.Dn], [pair(6), pair(10)]],
  [[M.ASL], [B, W, L], [O.Imm, O.Dn], pair(6)],
  [[M.ASL], [B, W, L], [O.Dn, O.Dn], pair(8)],
  [[M.ROL, M.ROR], [B, W, L], [O.Imm, O.Dn], pair(6)],
  [[M.ROL, M.ROR], [B, W, L], [O.Dn, O.Dn], pair(8)],
  [[M.ROXL, M.ROXR], [B, W, L], [O.Imm, O.Dn], pair(12)],
  [[M.ROXL, M.ROXR], [B, W, L], [O.Dn, O.Dn], pair(12)],
  [[M.LSL, M.LSR, M.ASR], [W], [Mem], pair(4, 4, 0, 1, 1)],
  [[M.ASL, M.ROL, M.ROR], [W], [Mem], pair(6, 6, 0, 1, 1)],
  [[M.ROXL, M.ROXR], [W], [Mem], pair(4)],
  [[M.ABCD, M.SBCD], [B], [O.Dn, O.Dn], pair(4)],
  [[M.ABCD, M.SBCD], [B], [O.AnPreDec, O.AnPreDec], pair(13, 14, 2, 1, 1)],
  [[M.ADDX, M.SUBX], [B, W, L], [O.Dn, O.Dn], pair(2)],
  [[M.ADDX, M.SUBX], [B, W, L], [O.AnPreDec, O.AnPreDec], pair(9, 10, 2, 1, 1)],
  [[M.CMPM], [B, W, L], [O.AnPostInc, O.AnPostInc], pair(8, 8, 2)],
  [[M.PACK], [null], [O.Dn, O.Dn, O.Imm], pair(6)],
  [[M.UNPK], [null], [O.Dn, O.Dn, O.Imm], pair(8)],
  [
    [M.PACK, M.UNPK],
    [null],
    [O.AnPreDec, O.AnPreDec, O.Imm],
    pair(11, 11, 1, 1, 1),
  ],
  [[M.BTST], [L], [O.Imm, O.Dn], pair(4)],
  [[M.BTST], [L], [O.Dn, O.Dn], pair(4)],
  [[M.BCHG, M.BCLR, M.BSET], [L], [O.Imm, O.Dn], pair(6)],
  [[M.BCHG, M.BCLR, M.BSET], [L], [O.Dn, O.Dn], pair(6)],
  [[M.BTST], [B], [O.Dn, Mem], pair(4)],
  [[M.BTST], [B], [O.Imm, Mem], pair(4), "fetchImm"],
  [[M.BCHG, M.BCLR, M.BSET], [B], [O.Dn, Mem], pair(6, 6, 0, 1, 1)],
  [
    [M.BCHG, M.BCLR, M.BSET],
    [B],
    [O.Imm, Mem],
    pair(6, 6, 0, 1, 1),
    "fetchImm",
  ],
  [BCC, [B], [O.AbsL], [pair(6, 8, 0, 2), pair(4)]],
  [BCC, [W], [O.AbsL], [pair(6, 8, 0, 2), pair(6)]],
  [BCC, [L], [O.AbsL], [pair(6, 8, 0, 2), pair(6, 8, 0, 2)]],
  [[M.BRA], [B, W, L], [O.AbsL], pair(6, 8, 0, 2)],
  [[M.BSR], [B, W, L], [O.AbsL], pair(6, 9, 0, 2, 1)],
  [
    DBCC,
    [W],
    [O.Dn, O.AbsL],
    [pair(6, 8, 0, 2), pair(6, 8), pair(10, 13, 0, 3)],
  ],
  [[M.LEA], [L], [Control, O.An], pair(2), "calc"],
  [[M.PEA], [L], [Control], pair(4, 4, 0, 1, 1), "calc"],
  [[M.JMP], [null], [Control], pair(4, 6, 0, 2), "jump"],
  [[M.JSR], [null], [Control], pair(4, 7, 0, 2, 1), "jump"],
  [[M.LINK], [W], [O.An, O.Imm], pair(4, 5, 0, 1, 1)],
  [[M.LINK], [L], [O.An, O.Imm], pair(6, 7, 0, 2, 1)],
  [[M.UNLK], [null], [O.An], pair(5, 5, 1)],
  [[M.NOP], [null], [], pair(2)],
  [[M.RTS], [null], [], pair(9, 11, 1, 2)],
  [[M.RTD], [null], [O.Imm], pair(10, 12, 1, 2)],
  [[M.RTR], [null], [], pair(12, 14, 2, 2)],
  [[M.SWAP], [W], [O.Dn], pair(4)],
  [[M.EXG], [L], [O.Dn, O.Dn], pair(4)],
  [[M.EXG], [L], [O.An, O.An], pair(4)],
  [[M.EXG], [L], [O.Dn, O.An], pair(4)],
  [
    [M.MOVEM],
    [W, L],
    [
      [
        O.AnIndir,
        O.AnPostInc,
        O.AnDisp,
        O.AnDispIx,
        O.PcDisp,
        O.PcDispIx,
        O.AbsW,
        O.AbsL,
      ],
      O.RegList,
    ],
    pair(8),
    "calcImm",
    [4, 1, 0, 0],
  ],
  [
    [M.MOVEM],
    [W, L],
    [O.RegList, [O.AnIndir, O.AnPreDec, O.AnDisp, O.AnDispIx, O.AbsW, O.AbsL]],
    pair(4),
    "calcImm",
    [2, 0, 0, 1],
  ],
  [[M.MOVEP], [W], [O.Dn, O.AnDisp], pair(10, 10, 0, 1, 2)],
  [[M.MOVEP], [L], [O.Dn, O.AnDisp], pair(14, 14, 0, 1, 4)],
  [[M.MOVEP], [W], [O.AnDisp, O.Dn], pair(10, 10, 2)],
  [[M.MOVEP], [L], [O.AnDisp, O.Dn], pair(14, 14, 4)],
  [[M.MOVE], [W, L], [O.USP, O.An], pair(4)],
  [[M.MOVE], [W, L], [O.An, O.USP], pair(4)],
  [[M.MOVE], [W], [O.SR, O.Dn], pair(4)],
  [[M.MOVE], [W], [O.CCR, O.Dn], pair(4)],
  [[M.MOVE], [W], [O.SR, Mem], pair(4, 5, 0, 1, 1), "calc"],
  [[M.MOVE], [W], [O.CCR, Mem], pair(4, 5, 0, 1, 1), "calc"],
  [[M.MOVE], [W], [EA, O.SR], pair(8, 10, 0, 2)],
  [[M.MOVE], [W], [EA, O.CCR], pair(4)],
  [[M.ANDI, M.ORI, M.EORI], [W], [O.Imm, O.SR], pair(12, 14, 0, 2)],
  [[M.ANDI, M.ORI, M.EORI], [B], [O.Imm, O.CCR], pair(12, 14, 0, 2)],
  [[M.MOVEC], [null], [O.AbsL, O.Dn], pair(6)],
  [[M.MOVEC], [null], [O.AbsL, O.An], pair(6)],
  [[M.MOVEC], [null], [O.Dn, O.AbsL], pair(6)],
  [[M.MOVEC], [null], [O.An, O.AbsL], pair(6)],
  [[M.MOVES], [B, W, L], [Mem, O.Dn], pair(7, 7, 1), "calcImm"],
  [[M.MOVES], [B, W, L], [Mem, O.An], pair(7, 7, 1), "calcImm"],
  [[M.MOVES], [B, W, L], [O.Dn, Mem], pair(5, 6, 0, 1, 1), "calcImm"],
  [[M.MOVES], [B, W, L], [O.An, Mem], pair(5, 6, 0, 1, 1), "calcImm"],
  [
    [M.CAS],
    [B, W, L],
    [O.Dn, O.Dn, Mem],
    [pair(11, 11, 1), pair(13, 13, 1, 1, 1)],
    "calcImm",
  ],
  [
    [M.CHK],
    [W, L],
    [EA, O.Dn],
    [pair(8), pair(28, 30, 1, 3, 4), pair(28, 30, 1, 3, 4)],
  ],
  [[M.CMP2], [B, W, L], [ReadMem, O.Dn], pair(20, 20, 1), "fetchImm"],
  [
    [M.CHK2],
    [B, W, L],
    [ReadMem, O.Dn],
    [pair(18, 18, 1), pair(40, 42, 2, 3, 4)],
    "fetchImm",
  ],
  // Register bitfields have no data-dependent memory span.
  [[M.BFTST], [null], [O.Dn], pair(8)],
  [[M.BFCHG, M.BFCLR, M.BFSET], [null], [O.Dn], pair(14)],
  [[M.BFEXTS, M.BFEXTU], [null], [O.Dn, O.Dn], pair(10)],
  [[M.BFINS], [null], [O.Dn, O.Dn], pair(12)],
  [[M.BFFFO], [null], [O.Dn, O.Dn], pair(20)],
  [[M.TRAP], [null], [O.Imm], pair(18, 20, 1, 2, 4)],
  [[M.ILLEGAL], [null], [], pair(18, 20, 1, 2, 4)],
  [[M.TRAPV], [null], [], [pair(4), pair(22, 24, 1, 2, 5)]],
  [[M.BKPT], [null], [O.Imm], pair(9, 9, 1, 0)],
  [[M.STOP], [null], [O.Imm], pair(8, 8, 0, 2)],
  [[M.RESET], [null], [], pair(518)],
];

// §11.6.6: destination base + source fetch, with register-source exceptions.
export const moveTimes: Timing2Row[] = [
  [[M.MOVE], [B, W, L], [EA, O.Dn], pair(2)],
  [[M.MOVE, M.MOVEA], [W, L], [EA, O.An], pair(2)],
];
for (const destination of Mem) {
  const base =
    destination === O.AbsL
      ? pair(6, 7, 0, 2, 1)
      : destination === O.AnDispIx
        ? pair(6, 7, 0, 1, 1)
        : pair(4, 5, 0, 1, 1);
  moveTimes.push([[M.MOVE], [B, W, L], [EA, destination], base]);
  if (
    new Set<AddressingMode>([O.AnIndir, O.AnPostInc, O.AnPreDec]).has(
      destination,
    )
  ) {
    for (const register of [O.Dn, O.An]) {
      moveTimes.push([
        [M.MOVE],
        register === O.An ? [W, L] : [B, W, L],
        [register, destination],
        destination === O.AnPreDec ? pair(4, 4, 0, 1, 1) : pair(3, 4, 0, 1, 1),
      ]);
    }
  }
}
