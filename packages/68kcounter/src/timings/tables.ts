import {
  mnemonicGroups,
  Mnemonics as M,
  AddressingModes as O,
  addressingModeGroups as OG,
  Qualifiers,
  type Mnemonic,
  type Qualifier,
  type AddressingMode,
} from "../syntax";
import { type Timing } from ".";

const { BCC, DBCC, SCC, SHIFT } = mnemonicGroups;
const { B, W, L } = Qualifiers;
const RegList = [O.RegList, O.Dn, O.An];

export type TimingTable = [
  Mnemonic[],
  (Qualifier | null)[],
  (AddressingMode | AddressingMode[])[],
  Timing[],
  Timing?,
][];

// Effective Address Calculation Times:

// prettier-ignore
export const lookupTimes: Record<string, [Timing, Timing]> = {
  //              B/W           L
  // Register:
  [O.Dn]:         [[0, 0, 0],   [0, 0, 0]],
  [O.An]:         [[0, 0, 0],   [0, 0, 0]],
  // Memory:
  [O.AnIndir]:    [[4, 1, 0],   [8, 2, 0]],
  [O.AnPostInc]:  [[4, 1, 0],   [8, 2, 0]],
  [O.AnPreDec]:   [[6, 1, 0],   [10, 2, 0]],
  [O.AnDisp]:     [[8, 2, 0],   [12, 3, 0]],
  [O.AnDispIx]:   [[10, 2, 0],  [14, 3, 0]],
  [O.AbsW]:       [[8, 2, 0],   [12, 3, 0]],
  [O.AbsL]:       [[12, 3, 0],  [16, 4, 0]],
  [O.PcDisp]:     [[8, 2, 0],   [12, 3, 0]],
  [O.PcDispIx]:   [[10, 2, 0],  [14, 3, 0]],
  // Immediate:
  [O.Imm]:        [[4, 1, 0],   [8, 2, 0]],
};

// prettier-ignore
export const baseTimes: TimingTable = [
  // Mnemonics:                      Sizes:     Operands:                    Timings:                 N Multipliers:
  //----------------------------------------------------------------------------------------------------------------
  // MOVE INSTRUCTION EXECUTION TIMES:
  // Move Byte and Word Instruction Execution Times:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.Dn, O.Dn],                [[4, 1, 0]]                          ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.Dn, O.An],                [[4, 1, 0]]                          ],
  [ [M.MOVE],                        [B, W],    [O.Dn, O.AnIndir],           [[8, 1, 1]]                          ],
  [ [M.MOVE],                        [B, W],    [O.Dn, O.AnPostInc],         [[8, 1, 1]]                          ],
  [ [M.MOVE],                        [B, W],    [O.Dn, O.AnPreDec],          [[8, 1, 1]]                          ],
  [ [M.MOVE],                        [B, W],    [O.Dn, O.AnDisp],            [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Dn, O.AnDispIx],          [[14, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Dn, O.AbsW],              [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Dn, O.AbsL],              [[16, 3, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.An, O.Dn],                [[4, 1, 0]]                          ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.An, O.An],                [[4, 1, 0]]                          ],
  [ [M.MOVE],                        [B, W],    [O.An, O.AnIndir],           [[8, 1, 1]]                          ],
  [ [M.MOVE],                        [B, W],    [O.An, O.AnPostInc],         [[8, 1, 1]]                          ],
  [ [M.MOVE],                        [B, W],    [O.An, O.AnPreDec],          [[8, 1, 1]]                          ],
  [ [M.MOVE],                        [B, W],    [O.An, O.AnDisp],            [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.An, O.AnDispIx],          [[14, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.An, O.AbsW],              [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.An, O.AbsL],              [[16, 3, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.AnIndir, O.Dn],           [[8, 2, 0]]                          ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.AnIndir, O.An],           [[8, 2, 0]]                          ],
  [ [M.MOVE],                        [B, W],    [O.AnIndir, O.AnIndir],      [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnIndir, O.AnPostInc],    [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnIndir, O.AnPreDec],     [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnIndir, O.AnDisp],       [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnIndir, O.AnDispIx],     [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnIndir, O.AbsW],         [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnIndir, O.AbsL],         [[20, 4, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.AnPostInc, O.Dn],         [[8, 2, 0]]                          ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.AnPostInc, O.An],         [[8, 2, 0]]                          ],
  [ [M.MOVE],                        [B, W],    [O.AnPostInc, O.AnIndir],    [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPostInc, O.AnPostInc],  [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPostInc, O.AnPreDec],   [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPostInc, O.AnDisp],     [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPostInc, O.AnDispIx],   [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPostInc, O.AbsW],       [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPostInc, O.AbsL],       [[20, 4, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.AnPreDec, O.Dn],          [[10, 2, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.AnPreDec, O.An],          [[10, 2, 0]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPreDec, O.AnIndir],     [[14, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPreDec, O.AnPostInc],   [[14, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPreDec, O.AnPreDec],    [[14, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPreDec, O.AnDisp],      [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPreDec, O.AnDispIx],    [[20, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPreDec, O.AbsW],        [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnPreDec, O.AbsL],        [[22, 4, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.AnDisp, O.Dn],            [[12, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.AnDisp, O.An],            [[12, 3, 0]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDisp, O.AnIndir],       [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDisp, O.AnPostInc],     [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDisp, O.AnPreDec],      [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDisp, O.AnDisp],        [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDisp, O.AnDispIx],      [[22, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDisp, O.AbsW],          [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDisp, O.AbsL],          [[24, 5, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.AnDispIx, O.Dn],          [[14, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.AnDispIx, O.An],          [[14, 3, 0]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDispIx, O.AnIndir],     [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDispIx, O.AnPostInc],   [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDispIx, O.AnPreDec],    [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDispIx, O.AnDisp],      [[22, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDispIx, O.AnDispIx],    [[24, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDispIx, O.AbsW],        [[22, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AnDispIx, O.AbsL],        [[26, 5, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.AbsW, O.Dn],              [[12, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.AbsW, O.An],              [[12, 3, 0]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsW, O.AnIndir],         [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsW, O.AnPostInc],       [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsW, O.AnPreDec],        [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsW, O.AnDisp],          [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsW, O.AnDispIx],        [[22, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsW, O.AbsW],            [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsW, O.AbsL],            [[24, 5, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.AbsL, O.Dn],              [[16, 4, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.AbsL, O.An],              [[16, 4, 0]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsL, O.AnIndir],         [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsL, O.AnPostInc],       [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsL, O.AnPreDec],        [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsL, O.AnDisp],          [[24, 5, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsL, O.AnDispIx],        [[26, 5, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsL, O.AbsW],            [[24, 5, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.AbsL, O.AbsL],            [[28, 6, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.PcDisp, O.Dn],            [[12, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.PcDisp, O.An],            [[12, 3, 0]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDisp, O.AnIndir],       [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDisp, O.AnPostInc],     [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDisp, O.AnPreDec],      [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDisp, O.AnDisp],        [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDisp, O.AnDispIx],      [[22, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDisp, O.AbsW],          [[20, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDisp, O.AbsL],          [[24, 5, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.PcDispIx, O.Dn],          [[14, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.PcDispIx, O.An],          [[14, 3, 0]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDispIx, O.AnIndir],     [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDispIx, O.AnPostInc],   [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDispIx, O.AnPreDec],    [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDispIx, O.AnDisp],      [[22, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDispIx, O.AnDispIx],    [[24, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDispIx, O.AbsW],        [[22, 4, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.PcDispIx, O.AbsL],        [[26, 5, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [B, W],    [O.Imm, O.Dn],               [[8, 2, 0]]                          ],
  [ [M.MOVE, M.MOVEA],               [B, W],    [O.Imm, O.An],               [[8, 2, 0]]                          ],
  [ [M.MOVE],                        [B, W],    [O.Imm, O.AnIndir],          [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Imm, O.AnPostInc],        [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Imm, O.AnPreDec],         [[12, 2, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Imm, O.AnDisp],           [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Imm, O.AnDispIx],         [[18, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Imm, O.AbsW],             [[16, 3, 1]]                         ],
  [ [M.MOVE],                        [B, W],    [O.Imm, O.AbsL],             [[20, 4, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  // Move Long Instruction Execution Times:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.Dn, O.Dn],                [[4, 1, 0]]                          ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.Dn, O.An],                [[4, 1, 0]]                          ],
  [ [M.MOVE],                        [L],       [O.Dn, O.AnIndir],           [[12, 1, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Dn, O.AnPostInc],         [[12, 1, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Dn, O.AnPreDec],          [[12, 1, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Dn, O.AnDisp],            [[16, 2, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Dn, O.AnDispIx],          [[18, 2, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Dn, O.AbsW],              [[16, 2, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Dn, O.AbsL],              [[20, 3, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.An, O.Dn],                [[4, 1, 0]]                          ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.An, O.An],                [[4, 1, 0]]                          ],
  [ [M.MOVE],                        [L],       [O.An, O.AnIndir],           [[12, 1, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.An, O.AnPostInc],         [[12, 1, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.An, O.AnPreDec],          [[12, 1, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.An, O.AnDisp],            [[16, 2, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.An, O.AnDispIx],          [[18, 2, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.An, O.AbsW],              [[16, 2, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.An, O.AbsL],              [[20, 3, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.AnIndir, O.Dn],           [[12, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.AnIndir, O.An],           [[12, 3, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.AnIndir, O.AnIndir],      [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnIndir, O.AnPostInc],    [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnIndir, O.AnPreDec],     [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnIndir, O.AnDisp],       [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnIndir, O.AnDispIx],     [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnIndir, O.AbsW],         [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnIndir, O.AbsL],         [[28, 5, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.AnPostInc, O.Dn],         [[12, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.AnPostInc, O.An],         [[12, 3, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPostInc, O.AnIndir],    [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPostInc, O.AnPostInc],  [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPostInc, O.AnPreDec],   [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPostInc, O.AnDisp],     [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPostInc, O.AnDispIx],   [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPostInc, O.AbsW],       [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPostInc, O.AbsL],       [[28, 5, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.AnPreDec, O.Dn],          [[14, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.AnPreDec, O.An],          [[14, 3, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPreDec, O.AnIndir],     [[22, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPreDec, O.AnPostInc],   [[22, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPreDec, O.AnPreDec],    [[22, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPreDec, O.AnDisp],      [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPreDec, O.AnDispIx],    [[28, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPreDec, O.AbsW],        [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnPreDec, O.AbsL],        [[30, 5, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.AnDisp, O.Dn],            [[16, 4, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.AnDisp, O.An],            [[16, 4, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDisp, O.AnIndir],       [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDisp, O.AnPostInc],     [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDisp, O.AnPreDec],      [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDisp, O.AnDisp],        [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDisp, O.AnDispIx],      [[30, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDisp, O.AbsW],          [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDisp, O.AbsL],          [[32, 6, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.AnDispIx, O.Dn],          [[18, 4, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.AnDispIx, O.An],          [[18, 4, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDispIx, O.AnIndir],     [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDispIx, O.AnPostInc],   [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDispIx, O.AnPreDec],    [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDispIx, O.AnDisp],      [[30, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDispIx, O.AnDispIx],    [[32, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDispIx, O.AbsW],        [[30, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AnDispIx, O.AbsL],        [[34, 6, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.AbsW, O.Dn],              [[16, 4, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.AbsW, O.An],              [[16, 4, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsW, O.AnIndir],         [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsW, O.AnPostInc],       [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsW, O.AnPreDec],        [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsW, O.AnDisp],          [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsW, O.AnDispIx],        [[30, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsW, O.AbsW],            [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsW, O.AbsL],            [[32, 6, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.AbsL, O.Dn],              [[20, 5, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.AbsL, O.An],              [[20, 5, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsL, O.AnIndir],         [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsL, O.AnPostInc],       [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsL, O.AnPreDec],        [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsL, O.AnDisp],          [[32, 6, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsL, O.AnDispIx],        [[34, 6, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsL, O.AbsW],            [[32, 6, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.AbsL, O.AbsL],            [[36, 7, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.PcDisp, O.Dn],            [[16, 4, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.PcDisp, O.An],            [[16, 4, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDisp, O.AnIndir],       [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDisp, O.AnPostInc],     [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDisp, O.AnPreDec],      [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDisp, O.AnDisp],        [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDisp, O.AnDispIx],      [[30, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDisp, O.AbsW],          [[28, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDisp, O.AbsL],          [[32, 6, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.PcDispIx, O.Dn],          [[18, 4, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.PcDispIx, O.An],          [[18, 4, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDispIx, O.AnIndir],     [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDispIx, O.AnPostInc],   [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDispIx, O.AnPreDec],    [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDispIx, O.AnDisp],      [[30, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDispIx, O.AnDispIx],    [[32, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDispIx, O.AbsW],        [[30, 5, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.PcDispIx, O.AbsL],        [[34, 6, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVE],                        [L],       [O.Imm, O.Dn],               [[12, 3, 0]]                         ],
  [ [M.MOVE, M.MOVEA],               [L],       [O.Imm, O.An],               [[12, 3, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.Imm, O.AnIndir],          [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Imm, O.AnPostInc],        [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Imm, O.AnPreDec],         [[20, 3, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Imm, O.AnDisp],           [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Imm, O.AnDispIx],         [[26, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Imm, O.AbsW],             [[24, 4, 2]]                         ],
  [ [M.MOVE],                        [L],       [O.Imm, O.AbsL],             [[28, 5, 2]]                         ],

  //----------------------------------------------------------------------------------------------------------------
  // STANDARD INSTRUCTION EXECUTION TIMES:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.ADD, M.SUB],                  [B, W],    [OG.EA, O.An],               [[8, 1, 0]]                          ],
  [ [M.ADDA, M.SUBA],                [W],       [OG.EA, O.An],               [[8, 1, 0]]                          ],
  [ [M.ADD, M.SUB],                  [B, W],    [OG.EA, O.Dn],               [[4, 1, 0]]                          ],
  [ [M.ADD, M.SUB],                  [B, W],    [O.Dn, OG.M],                [[8, 1, 1]]                          ],
  [ [M.ADD, M.ADDA, M.SUB, M.SUBA],  [L],       [OG.M, O.An],                [[6, 1, 0]]                          ],
  [ [M.ADD, M.SUB],                  [L],       [OG.M, O.Dn],                [[6, 1, 0]]                          ],
  [ [M.ADD, M.ADDA, M.SUB, M.SUBA],  [L],       [OG.DI, O.An],               [[8, 1, 0]]                          ],
  [ [M.ADD, M.SUB],                  [L],       [OG.DI, O.Dn],               [[8, 1, 0]]                          ],
  [ [M.ADD, M.SUB],                  [L],       [O.Dn, OG.M],                [[12, 1, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.AND, M.OR],                   [B, W],    [OG.EA, O.Dn],               [[4, 1, 0]]                          ],
  [ [M.AND, M.OR],                   [B, W],    [O.Dn, OG.M],                [[8, 1, 1]]                          ],
  [ [M.AND, M.OR],                   [L],       [OG.M, O.Dn],                [[6, 1, 0]]                          ],
  [ [M.AND, M.OR],                   [L],       [OG.DI, O.Dn],               [[8, 1, 0]]                          ],
  [ [M.AND, M.OR],                   [L],       [O.Dn, OG.M],                [[12, 1, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.EOR],                         [B, W],    [O.Dn, O.Dn],                [[4, 1, 0]]                          ],
  [ [M.EOR],                         [B, W],    [O.Dn, OG.M],                [[8, 1, 1]]                          ],
  [ [M.EOR],                         [L],       [O.Dn, O.Dn],                [[8, 1, 0]]                          ],
  [ [M.EOR],                         [L],       [O.Dn, OG.M],                [[12, 1, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.CMP],                         [B, W],    [OG.EA, O.An],               [[6, 1, 0]]                          ],
  [ [M.CMPA],                        [W],       [OG.EA, O.An],               [[6, 1, 0]]                          ],
  [ [M.CMP, M.CMPA],                 [L],       [OG.EA, O.An],               [[6, 1, 0]]                          ],
  [ [M.CMP],                         [L],       [OG.EA, O.Dn],               [[6, 1, 0]]                          ],
  [ [M.CMP],                         [B, W],    [OG.EA, O.Dn],               [[4, 1, 0]]                          ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.DIVS],                        [W],       [OG.EA, O.Dn],               [[158, 1, 0]]                        ],
  [ [M.DIVU],                        [W],       [OG.EA, O.Dn],               [[140, 1, 0]]                        ],
  [ [M.MULS, M.MULU],                [W],       [OG.EA, O.Dn],               [[38, 1, 0]],               [2, 0, 0]],
  //----------------------------------------------------------------------------------------------------------------
  // Immediate Instruction Execution Times:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.ADD, M.ADDI, M.SUB, M.SUBI],  [B, W],    [O.Imm, O.Dn],               [[8, 2, 0]]                          ],
  [ [M.ADD, M.ADDI, M.SUB, M.SUBI],  [B, W],    [O.Imm, OG.M],               [[12, 2, 1]]                         ],
  [ [M.ADD, M.ADDI, M.SUB, M.SUBI],  [L],       [O.Imm, O.Dn],               [[16, 3, 0]]                         ],
  [ [M.ADD, M.ADDI, M.SUB, M.SUBI],  [L],       [O.Imm, OG.M],               [[20, 3, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.ADDQ, M.SUBQ],                [B, W],    [O.Imm, O.Dn],               [[4, 1, 0]]                          ],
  [ [M.ADDQ, M.SUBQ],                [B, W],    [O.Imm, O.An],               [[8, 1, 0]]                          ],
  [ [M.ADDQ, M.SUBQ],                [B, W],    [O.Imm, OG.M],               [[8, 1, 1]]                          ],
  [ [M.ADDQ, M.SUBQ],                [L],       [O.Imm, O.Dn],               [[8, 1, 0]]                          ],
  [ [M.ADDQ, M.SUBQ],                [L],       [O.Imm, O.An],               [[8, 1, 0]]                          ],
  [ [M.ADDQ, M.SUBQ],                [L],       [O.Imm, OG.M],               [[12, 1, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.AND, M.ANDI, M.OR, M.ORI],    [B, W],    [O.Imm, O.Dn],               [[8, 2, 0]]                          ],
  [ [M.AND, M.ANDI, M.OR, M.ORI],    [B, W],    [O.Imm, OG.M],               [[12, 2, 1]]                         ],
  [ [M.AND, M.ANDI, M.OR, M.ORI],    [L],       [O.Imm, O.Dn],               [[16, 3, 0]]                         ],
  [ [M.AND, M.ANDI, M.OR, M.ORI],    [L],       [O.Imm, OG.M],               [[20, 3, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.CMP, M.CMPI],                 [B, W],    [O.Imm, O.Dn],               [[8, 2, 0]]                          ],
  [ [M.CMP, M.CMPI],                 [B, W],    [O.Imm, OG.M],               [[8, 2, 0]]                          ],
  [ [M.CMP, M.CMPI],                 [L],       [O.Imm, O.Dn],               [[14, 3, 0]]                         ],
  [ [M.CMP, M.CMPI],                 [L],       [O.Imm, OG.M],               [[12, 3, 0]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.EOR, M.EORI],                 [B, W],    [O.Imm, O.Dn],               [[8, 2, 0]]                          ],
  [ [M.EOR, M.EORI],                 [B, W],    [O.Imm, OG.M],               [[12, 2, 1]]                         ],
  [ [M.EOR, M.EORI],                 [L],       [O.Imm, O.Dn],               [[16, 3, 0]]                         ],
  [ [M.EOR, M.EORI],                 [L],       [O.Imm, OG.M],               [[20, 3, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVEQ],                       [L],       [O.Imm, O.Dn],               [[4, 1, 0]]                          ],

  //----------------------------------------------------------------------------------------------------------------
  // SINGLE OPERAND INSTRUCTION EXECUTION TIMES:                              Taken      Not taken:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.CLR, M.NOT, M.NEG],           [B, W],    [O.Dn],                      [[4, 1, 0]]                          ],
  [ [M.CLR, M.NOT, M.NEG],           [B, W],    [OG.M],                      [[8, 1, 1]]                          ],
  [ [M.CLR, M.NOT, M.NEG],           [L],       [O.Dn],                      [[6, 1, 0]]                          ],
  [ [M.CLR, M.NOT, M.NEG],           [L],       [OG.M],                      [[12, 1, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.NBCD],                        [B],       [O.Dn],                      [[6, 1, 0]]                          ],
  [ [M.NBCD],                        [B],       [OG.M],                      [[8, 1, 1]]                          ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.NEGX],                        [B, W],    [O.Dn],                      [[4, 1, 0]]                          ],
  [ [M.NEGX],                        [B, W],    [OG.M],                      [[8, 1, 1]]                          ],
  [ [M.NEGX],                        [L],       [O.Dn],                      [[6, 1, 0]]                          ],
  [ [M.NEGX],                        [L],       [OG.M],                      [[12, 1, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ SCC,                             [B],       [O.Dn],                      [[4, 1, 0], [6, 1, 0]]               ],
  [ SCC,                             [B],       [OG.M],                      [[8, 1, 1], [8, 1, 1]]               ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.TAS],                         [B],       [O.Dn],                      [[4, 1, 0]]                          ],
  [ [M.TAS],                         [B],       [OG.M],                      [[10, 1, 1]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.TST],                         [B, W, L], [O.Dn],                      [[4, 1, 0]]                          ],
  [ [M.TST],                         [B, W, L], [OG.M],                      [[4, 1, 0]]                          ],

  //----------------------------------------------------------------------------------------------------------------
  // SHIFT/ROTATE INSTRUCTION EXECUTION TIMES:
  //----------------------------------------------------------------------------------------------------------------
  [ SHIFT,                           [B, W],    [O.Imm, O.Dn],               [[6, 1, 0]],                [2, 0, 0]],
  [ SHIFT,                           [B, W],    [O.Imm, OG.M],               [[8, 1, 1]],                [2, 0, 0]],
  [ SHIFT,                           [B, W],    [O.Dn, O.Dn],                [[6, 1, 0]],                [2, 0, 0]],
  [ SHIFT,                           [B, W],    [O.Dn, OG.M],                [[8, 1, 1]],                [2, 0, 0]],
  [ SHIFT,                           [B, W],    [O.Dn],                      [[8, 1, 0]],                         ],
  [ SHIFT,                           [B, W],    [OG.M],                      [[8, 1, 1]],                         ],
  [ SHIFT,                           [L],       [O.Imm, O.Dn],               [[8, 1, 0]],                [2, 0, 0]],
  [ SHIFT,                           [L],       [O.Dn],                      [[10, 1, 0]],                        ],
  [ SHIFT,                           [L],       [O.Dn, O.Dn],                [[8, 1, 0]],                [2, 0, 0]],

  //----------------------------------------------------------------------------------------------------------------
  // BIT MANIPULATION INSTRUCTION EXECUTION TIMES:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.BCHG, M.BSET, M.BCLR],        [B],       [O.Dn, OG.M],                [[8, 1, 1]]                          ],
  [ [M.BCHG, M.BSET, M.BCLR],        [B],       [O.Imm, OG.M],               [[12, 2, 1]]                         ],
  [ [M.BCHG, M.BSET],                [L],       [O.Dn, O.Dn],                [[8, 1, 0]]                          ],
  [ [M.BCHG, M.BSET],                [L],       [O.Imm, O.Dn],               [[12, 2, 0]]                         ],
  [ [M.BCLR],                        [L],       [O.Dn, O.Dn],                [[10, 1, 0]]                         ],
  [ [M.BCLR],                        [L],       [O.Imm, O.Dn],               [[14, 2, 0]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.BTST],                        [B],       [O.Dn, OG.M],                [[4, 1, 0]]                          ],
  [ [M.BTST],                        [B],       [O.Imm, OG.M],               [[8, 2, 0]]                          ],
  [ [M.BTST],                        [B],       [O.Dn, O.Imm],               [[10, 2, 0]]                         ],
  [ [M.BTST],                        [L],       [O.Dn, O.Dn],                [[6, 1, 0]]                          ],
  [ [M.BTST],                        [L],       [O.Imm, O.Dn],               [[10, 2, 0]]                         ],

  //----------------------------------------------------------------------------------------------------------------
  // CONDITIONAL INSTRUCTION EXECUTION TIMES:                                 Taken:      Not taken:  Expired:
  //----------------------------------------------------------------------------------------------------------------
  [ BCC,                             [B],       [O.AbsL],                    [[10, 2, 0], [8, 1, 0]]              ],
  [ BCC,                             [W],       [O.AbsL],                    [[10, 2, 0], [12, 2, 0]]             ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.BRA],                         [B, W],    [O.AbsL],                    [[10, 2, 0]]                         ],
  [ [M.BSR],                         [B, W],    [O.AbsL],                    [[18, 2, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ DBCC,                            [W],       [O.Dn, O.AbsL],              [[10, 2, 0], [12, 2, 0], [14, 3, 0]] ],

  //----------------------------------------------------------------------------------------------------------------
  // JMP, JSR, LEA, PEA, AND MOVEM INSTRUCTION EXECUTION TIMES:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.JMP],                         [null],    [O.AnIndir],                 [[8, 2, 0]]                          ],
  [ [M.JMP],                         [null],    [O.AnDisp],                  [[10, 2, 0]]                         ],
  [ [M.JMP],                         [null],    [O.AnDispIx],                [[14, 2, 0]]                         ],
  [ [M.JMP],                         [null],    [O.AbsW],                    [[10, 2, 0]]                         ],
  [ [M.JMP],                         [null],    [O.AbsL],                    [[12, 3, 0]]                         ],
  [ [M.JMP],                         [null],    [O.PcDisp],                  [[10, 2, 0]]                         ],
  [ [M.JMP],                         [null],    [O.PcDispIx],                [[14, 2, 0]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.JSR],                         [null],    [O.AnIndir],                 [[16, 2, 2]]                         ],
  [ [M.JSR],                         [null],    [O.AnDisp],                  [[18, 2, 2]]                         ],
  [ [M.JSR],                         [null],    [O.AnDispIx],                [[22, 2, 2]]                         ],
  [ [M.JSR],                         [null],    [O.AbsW],                    [[18, 2, 2]]                         ],
  [ [M.JSR],                         [null],    [O.AbsL],                    [[20, 3, 2]]                         ],
  [ [M.JSR],                         [null],    [O.PcDisp],                  [[18, 2, 2]]                         ],
  [ [M.JSR],                         [null],    [O.PcDispIx],                [[22, 2, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.LEA],                         [L],       [O.AnIndir, O.An],           [[4, 1, 0]]                          ],
  [ [M.LEA],                         [L],       [O.AnDisp, O.An],            [[8, 2, 0]]                          ],
  [ [M.LEA],                         [L],       [O.AnDispIx, O.An],          [[12, 2, 0]]                         ],
  [ [M.LEA],                         [L],       [O.AbsW, O.An],              [[8, 2, 0]]                          ],
  [ [M.LEA],                         [L],       [O.AbsL, O.An],              [[12, 3, 0]]                         ],
  [ [M.LEA],                         [L],       [O.PcDisp, O.An],            [[8, 2, 0]]                          ],
  [ [M.LEA],                         [L],       [O.PcDispIx, O.An],          [[12, 2, 0]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.PEA],                         [L],       [O.AnIndir],                 [[12, 1, 2]]                         ],
  [ [M.PEA],                         [L],       [O.AnDisp],                  [[16, 2, 2]]                         ],
  [ [M.PEA],                         [L],       [O.AnDispIx],                [[20, 2, 2]]                         ],
  [ [M.PEA],                         [L],       [O.AbsW],                    [[16, 2, 2]]                         ],
  [ [M.PEA],                         [L],       [O.AbsL],                    [[20, 3, 2]]                         ],
  [ [M.PEA],                         [L],       [O.PcDisp],                  [[16, 2, 2]]                         ],
  [ [M.PEA],                         [L],       [O.PcDispIx],                [[20, 2, 2]]                         ],
  // M => R --------------------------------------------------------------------------------------------------------
  [ [M.MOVEM],                       [W],       [O.AnIndir, RegList],      [[12, 3, 0]],               [4, 1, 0]],
  [ [M.MOVEM],                       [W],       [O.AnPostInc, RegList],    [[12, 3, 0]],               [4, 1, 0]],
  [ [M.MOVEM],                       [W],       [O.AnDisp, RegList],       [[16, 4, 0]],               [4, 1, 0]],
  [ [M.MOVEM],                       [W],       [O.AnDispIx, RegList],     [[18, 4, 0]],               [4, 1, 0]],
  [ [M.MOVEM],                       [W],       [O.AbsW, RegList],         [[16, 4, 0]],               [4, 1, 0]],
  [ [M.MOVEM],                       [W],       [O.AbsL, RegList],         [[20, 5, 0]],               [4, 1, 0]],
  [ [M.MOVEM],                       [W],       [O.PcDisp, RegList],       [[16, 4, 0]],               [4, 1, 0]],
  [ [M.MOVEM],                       [W],       [O.PcDispIx, RegList],     [[18, 4, 0]],               [4, 1, 0]],
  [ [M.MOVEM],                       [L],       [O.AnIndir, RegList],      [[12, 3, 0]],               [8, 2, 0]],
  [ [M.MOVEM],                       [L],       [O.AnPostInc, RegList],    [[12, 3, 0]],               [8, 2, 0]],
  [ [M.MOVEM],                       [L],       [O.AnDisp, RegList],       [[16, 4, 0]],               [8, 2, 0]],
  [ [M.MOVEM],                       [L],       [O.AnDispIx, RegList],     [[18, 4, 0]],               [8, 2, 0]],
  [ [M.MOVEM],                       [L],       [O.AbsW, RegList],         [[16, 4, 0]],               [8, 2, 0]],
  [ [M.MOVEM],                       [L],       [O.AbsL, RegList],         [[20, 5, 0]],               [8, 2, 0]],
  [ [M.MOVEM],                       [L],       [O.PcDisp, RegList],       [[16, 4, 0]],               [8, 2, 0]],
  [ [M.MOVEM],                       [L],       [O.PcDispIx, RegList],     [[18, 4, 0]],               [8, 2, 0]],
  // R => M --------------------------------------------------------------------------------------------------------
  [ [M.MOVEM],                       [W],       [RegList, O.AnIndir],      [[8, 2, 0]],                [4, 0, 1]],
  [ [M.MOVEM],                       [W],       [RegList, O.AnPreDec],     [[8, 2, 0]],                [4, 0, 1]],
  [ [M.MOVEM],                       [W],       [RegList, O.AnDisp],       [[12, 3, 0]],               [4, 0, 1]],
  [ [M.MOVEM],                       [W],       [RegList, O.AnDispIx],     [[14, 3, 0]],               [4, 0, 1]],
  [ [M.MOVEM],                       [W],       [RegList, O.AbsW],         [[12, 3, 0]],               [4, 0, 1]],
  [ [M.MOVEM],                       [W],       [RegList, O.AbsL],         [[16, 4, 0]],               [4, 0, 1]],
  [ [M.MOVEM],                       [L],       [RegList, O.AnIndir],      [[8, 2, 0]],                [8, 0, 2]],
  [ [M.MOVEM],                       [L],       [RegList, O.AnPreDec],     [[8, 2, 0]],                [8, 0, 2]],
  [ [M.MOVEM],                       [L],       [RegList, O.AnDisp],       [[12, 3, 0]],               [8, 0, 2]],
  [ [M.MOVEM],                       [L],       [RegList, O.AnDispIx],     [[14, 3, 0]],               [8, 0, 2]],
  [ [M.MOVEM],                       [L],       [RegList, O.AbsW],         [[12, 3, 0]],               [8, 0, 2]],
  [ [M.MOVEM],                       [L],       [RegList, O.AbsL],         [[16, 4, 0]],               [8, 0, 2]],

  //----------------------------------------------------------------------------------------------------------------
  // MULTIPRECISION INSTRUCTION EXECUTION TIMES:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.ADDX, M.SUBX],                [B, W],    [O.Dn, O.Dn],                [[4, 1, 0]]                          ],
  [ [M.ADDX, M.SUBX],                [B, W],    [O.AnPreDec, O.AnPreDec],    [[18, 3, 1]]                         ],
  [ [M.ADDX, M.SUBX],                [L],       [O.Dn, O.Dn],                [[8, 1, 0]]                          ],
  [ [M.ADDX, M.SUBX],                [L],       [O.AnPreDec, O.AnPreDec],    [[30, 5, 2]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.CMPM],                        [B, W],    [O.AnPostInc, O.AnPostInc],  [[12, 3, 0]]                         ],
  [ [M.CMPM],                        [L],       [O.AnPostInc, O.AnPostInc],  [[20, 5, 0]]                         ],
  //----------------------------------------------------------------------------------------------------------------
  [ [M.ABCD, M.SBCD],                [B],       [O.Dn, O.Dn],                [[6, 1, 0]]                          ],
  [ [M.ABCD, M.SBCD],                [B],       [O.AnPreDec, O.AnPreDec],    [[18, 3, 1]]                         ],

  //----------------------------------------------------------------------------------------------------------------
  // MISCELLANEOUS INSTRUCTION EXECUTION TIMES:                              No trap:     Trap >:     Trap <:
  //----------------------------------------------------------------------------------------------------------------
  [ [M.CHK],                         [W,L],     [OG.EA, O.Dn],               [[10, 1, 0], [38, 5, 3], [40, 5, 3]] ],

  [ [M.EXG],                         [L],       [O.Dn,O.Dn],                 [[6, 1, 0]]                          ],
  [ [M.EXG],                         [L],       [O.Dn, O.An],                [[6, 1, 0]]                          ],
  [ [M.EXG],                         [L],       [O.An,O.Dn],                 [[6, 1, 0]]                          ],
  [ [M.EXG],                         [L],       [O.An, O.An],                [[6, 1, 0]]                          ],
  [ [M.EXT],                         [W, L],    [O.Dn],                      [[4, 1, 0]]                          ],
  [ [M.LINK],                        [W, L],    [O.An,O.Imm],                [[16, 2, 2]]                         ],
  [ [M.NOP],                         [null],    [],                          [[4, 1, 0]]                          ],
  [ [M.RESET],                       [null],    [],                          [[132, 1, 0]]                        ],
  [ [M.RTE],                         [null],    [],                          [[20, 5, 0]]                         ],
  [ [M.RTR],                         [null],    [],                          [[20, 5, 0]]                         ],
  [ [M.RTS],                         [null],    [],                          [[16, 4, 0]]                         ],
  [ [M.STOP],                        [null],    [O.Imm],                     [[4, 1, 0]]                          ],
  [ [M.SWAP],                        [W],       [O.Dn],                      [[4, 1, 0]]                          ],
  [ [M.TRAP],                        [null],    [O.Imm],                     [[34, 4, 3]]                         ],
  [ [M.TRAPV],                       [null],    [],                          [[4, 1, 0], [34, 5, 3]]              ],
  [ [M.UNLK],                        [null],    [O.An],                      [[12, 3, 0]]                         ],
  [ [M.ILLEGAL],                     [null],    [],                          [[34, 4, 3]]                         ],

  //----------------------------------------------------------------------------------------------------------------
  // CCR/SR
  //----------------------------------------------------------------------------------------------------------------
  [ [M.AND, M.ANDI, M.EOR, M.EORI],  [B, W],    [O.Imm, O.CCR],              [[20, 3, 0]]                         ],
  [ [M.OR, M.ORI],                   [B, W],    [O.Imm, O.CCR],              [[20, 3, 0]]                         ],
  [ [M.AND, M.ANDI, M.EOR, M.EORI],  [B, W],    [O.Imm, O.SR],               [[20, 3, 0]]                         ],
  [ [M.OR, M.ORI],                   [B, W],    [O.Imm, O.SR],               [[20, 3, 0]]                         ],
  [ [M.MOVE],                        [W],       [O.SR, OG.EA],               [[6, 1, 0]]                          ],
  [ [M.MOVE],                        [W],       [OG.EA, O.CCR],              [[12, 1, 0]]                         ],
  [ [M.MOVE],                        [W],       [OG.EA, O.SR],               [[12, 1, 0]]                         ],
  [ [M.MOVE],                        [L],       [O.An, O.USP],               [[4, 1, 0]]                          ],
  [ [M.MOVE],                        [L],       [O.USP, O.An],               [[4, 1, 0]]                          ],

  //----------------------------------------------------------------------------------------------------------------
  // Move Peripheral Instruction Execution Times
  //----------------------------------------------------------------------------------------------------------------
  [ [M.MOVEP],                       [W],       [O.Dn, O.AnDisp],            [[16, 2, 2]]                         ],
  [ [M.MOVEP],                       [W],       [O.AnDisp, O.Dn],            [[16, 4, 0]]                         ],
  [ [M.MOVEP],                       [L],       [O.Dn, O.AnDisp],            [[24, 2, 4]]                         ],
  [ [M.MOVEP],                       [L],       [O.AnDisp, O.Dn],            [[24, 6, 0]]                         ],
];
