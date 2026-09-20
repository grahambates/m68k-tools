import { canonicalConditionMnemonic } from "m68k-parser";

type Values<T> = T[keyof T];

/**
 * Target CPU models for which timing/size data is available.
 */
export const Cpus = {
  MC68000: "68000",
  MC68020: "68020",
  MC68030: "68030",
  MC68040: "68040",
  MC68060: "68060",
} as const;

export type Cpu = Values<typeof Cpus>;

export const defaultCpu: Cpu = Cpus.MC68000;

/**
 * Which instruction-cache case to report. `worst` retains its original name:
 * it selects the 68020 worst case or the 68030 average no-cache case.
 * (The 68000 has no cache and ignores this.)
 */
export const CacheModels = {
  Cache: "cache",
  Worst: "worst",
} as const;

export type CacheModel = Values<typeof CacheModels>;

export const defaultCacheModel: CacheModel = CacheModels.Worst;

/**
 * Normalise a CPU identifier from a `--cpu` argument or a source directive
 * (e.g. `machine mc68020`, `mc68020`) to a supported {@link Cpu}, or
 * `undefined` if it isn't a target we model.
 */
export function toCpu(value: string): Cpu | undefined {
  switch (value.toLowerCase().replace(/^mc?/, "")) {
    case "68000":
      return Cpus.MC68000;
    case "68020":
      return Cpus.MC68020;
    case "68030":
      return Cpus.MC68030;
    case "68040":
      return Cpus.MC68040;
    case "68060":
      return Cpus.MC68060;
    default:
      return undefined;
  }
}

export const Mnemonics = {
  ABCD: "ABCD",
  ADD: "ADD",
  ADDA: "ADDA",
  ADDI: "ADDI",
  ADDQ: "ADDQ",
  ADDX: "ADDX",
  AND: "AND",
  ANDI: "ANDI",
  ASL: "ASL",
  ASR: "ASR",
  BCC: "BCC",
  BCHG: "BCHG",
  BCLR: "BCLR",
  BCS: "BCS",
  BEQ: "BEQ",
  BGE: "BGE",
  BGT: "BGT",
  BHI: "BHI",
  BLE: "BLE",
  BLT: "BLT",
  BMI: "BMI",
  BNE: "BNE",
  BPL: "BPL",
  BRA: "BRA",
  BSET: "BSET",
  BSR: "BSR",
  BTST: "BTST",
  BVC: "BVC",
  BVS: "BVS",
  BLS: "BLS",
  CHK: "CHK",
  CLR: "CLR",
  CMP: "CMP",
  CMPA: "CMPA",
  CMPI: "CMPI",
  CMPM: "CMPM",
  DBCC: "DBCC",
  DBCS: "DBCS",
  DBEQ: "DBEQ",
  DBF: "DBF",
  DBGE: "DBGE",
  DBGT: "DBGT",
  DBHI: "DBHI",
  DBLE: "DBLE",
  DBLT: "DBLT",
  DBMI: "DBMI",
  DBNE: "DBNE",
  DBPL: "DBPL",
  DBT: "DBT",
  DBVC: "DBVC",
  DBVS: "DBVS",
  DBLS: "DBLS",
  DIVS: "DIVS",
  DIVU: "DIVU",
  EOR: "EOR",
  EORI: "EORI",
  EXG: "EXG",
  EXT: "EXT",
  JMP: "JMP",
  JSR: "JSR",
  LEA: "LEA",
  LINK: "LINK",
  LSL: "LSL",
  LSR: "LSR",
  MOVE: "MOVE",
  MOVEA: "MOVEA",
  MOVEM: "MOVEM",
  MOVEP: "MOVEP",
  MOVEQ: "MOVEQ",
  MULS: "MULS",
  MULU: "MULU",
  NBCD: "NBCD",
  NEG: "NEG",
  NEGX: "NEGX",
  NOP: "NOP",
  NOT: "NOT",
  OR: "OR",
  ORI: "ORI",
  PEA: "PEA",
  RESET: "RESET",
  ROL: "ROL",
  ROR: "ROR",
  ROXL: "ROXL",
  ROXR: "ROXR",
  RTE: "RTE",
  RTR: "RTR",
  RTS: "RTS",
  SBCD: "SBCD",
  SCC: "SCC",
  SCS: "SCS",
  SEQ: "SEQ",
  SGE: "SGE",
  SGT: "SGT",
  SHI: "SHI",
  SLE: "SLE",
  SLT: "SLT",
  SMI: "SMI",
  SNE: "SNE",
  SPL: "SPL",
  SF: "SF",
  ST: "ST",
  SLS: "SLS",
  STOP: "STOP",
  SUB: "SUB",
  SUBA: "SUBA",
  SUBI: "SUBI",
  SUBQ: "SUBQ",
  SUBX: "SUBX",
  SVC: "SVC",
  SVS: "SVS",
  SWAP: "SWAP",
  TAS: "TAS",
  TRAP: "TRAP",
  TRAPV: "TRAPV",
  TST: "TST",
  UNLK: "UNLK",
  ILLEGAL: "ILLEGAL",
  // 68020+ integer instructions:
  BKPT: "BKPT",
  CAS: "CAS",
  CAS2: "CAS2",
  CHK2: "CHK2",
  CMP2: "CMP2",
  DIVSL: "DIVSL",
  DIVUL: "DIVUL",
  EXTB: "EXTB",
  MOVEC: "MOVEC",
  MOVES: "MOVES",
  PACK: "PACK",
  RTD: "RTD",
  UNPK: "UNPK",
  // Bit field manipulation:
  BFCHG: "BFCHG",
  BFCLR: "BFCLR",
  BFEXTS: "BFEXTS",
  BFEXTU: "BFEXTU",
  BFFFO: "BFFFO",
  BFINS: "BFINS",
  BFSET: "BFSET",
  BFTST: "BFTST",
} as const;

export type Mnemonic = Values<typeof Mnemonics>;

export function isMnemonic(v: string): v is Mnemonic {
  return Mnemonics[v as Mnemonic] !== undefined;
}

export const Qualifiers = {
  B: "B",
  W: "W",
  L: "L",
  Q: "Q",
  S: "S",
  D: "D",
  X: "X",
} as const;

export type Qualifier = Values<typeof Qualifiers>;

export function isQualifier(v: string): v is Qualifier {
  return Qualifiers[v as Qualifier] !== undefined;
}

export const AddressingModes = {
  Dn: "Dn",
  An: "An",
  AnIndir: "(An)",
  AnPostInc: "(An)+",
  AnPreDec: "-(An)",
  AnDisp: "d(An)",
  AnDispIx: "d(An,ix)",
  PcDisp: "d(PC)",
  PcDispIx: "d(PC,ix)",
  AbsW: "xxx.W",
  AbsL: "xxx.L",
  // 68020+ memory indirect: ([bd,An,Xn],od)
  MemIndir: "([bd,An,ix],od)",
  RegList: "RegList",
  Imm: "#xxx",
  CCR: "ccr",
  SR: "sr",
  USP: "usp",
} as const;

export type AddressingMode = Values<typeof AddressingModes>;

// Groups

export type MnemonicGroup = "BCC" | "DBCC" | "SCC" | "SHIFT";

export const mnemonicGroups: Record<MnemonicGroup, Mnemonic[]> = {
  SCC: [
    Mnemonics.SCC,
    Mnemonics.SCS,
    Mnemonics.SEQ,
    Mnemonics.SGE,
    Mnemonics.SGT,
    Mnemonics.SHI,
    Mnemonics.SLE,
    Mnemonics.SLT,
    Mnemonics.SMI,
    Mnemonics.SNE,
    Mnemonics.SPL,
    Mnemonics.SVC,
    Mnemonics.SVS,
    Mnemonics.ST,
    Mnemonics.SF,
    Mnemonics.SLS,
  ],
  BCC: [
    Mnemonics.BCC,
    Mnemonics.BCS,
    Mnemonics.BEQ,
    Mnemonics.BGE,
    Mnemonics.BGT,
    Mnemonics.BHI,
    Mnemonics.BLE,
    Mnemonics.BLT,
    Mnemonics.BMI,
    Mnemonics.BNE,
    Mnemonics.BPL,
    Mnemonics.BVC,
    Mnemonics.BVS,
    Mnemonics.BLS,
  ],
  DBCC: [
    Mnemonics.DBCC,
    Mnemonics.DBCS,
    Mnemonics.DBEQ,
    Mnemonics.DBF,
    Mnemonics.DBGE,
    Mnemonics.DBGT,
    Mnemonics.DBHI,
    Mnemonics.DBLE,
    Mnemonics.DBLT,
    Mnemonics.DBMI,
    Mnemonics.DBNE,
    Mnemonics.DBPL,
    Mnemonics.DBT,
    Mnemonics.DBVC,
    Mnemonics.DBVS,
    Mnemonics.DBLS,
  ],
  SHIFT: [
    Mnemonics.LSL,
    Mnemonics.LSR,
    Mnemonics.ASL,
    Mnemonics.ASR,
    Mnemonics.ROL,
    Mnemonics.ROR,
    Mnemonics.ROXL,
    Mnemonics.ROXR,
  ],
};

export type AddressingModeGroup = "EA" | "DI" | "M";

export const addressingModeGroups: Record<
  AddressingModeGroup,
  AddressingMode[]
> = {
  EA: [
    AddressingModes.Dn,
    AddressingModes.An,
    AddressingModes.AnIndir,
    AddressingModes.AnPostInc,
    AddressingModes.AnPreDec,
    AddressingModes.AnDisp,
    AddressingModes.AnDispIx,
    AddressingModes.PcDisp,
    AddressingModes.PcDispIx,
    AddressingModes.AbsW,
    AddressingModes.AbsL,
    AddressingModes.Imm,
  ],
  DI: [AddressingModes.Dn, AddressingModes.An, AddressingModes.Imm],
  M: [
    AddressingModes.AnIndir,
    AddressingModes.AnPostInc,
    AddressingModes.AnPreDec,
    AddressingModes.AnDisp,
    AddressingModes.AnDispIx,
    AddressingModes.PcDisp,
    AddressingModes.PcDispIx,
    AddressingModes.AbsW,
    AddressingModes.AbsL,
  ],
};

export const Directives = {
  // Memory:
  DC: "DC",
  DCB: "DCB",
  DS: "DS",
  DB: "DB",
  DW: "DW",
  DL: "DL",
  // Sections:
  SECTION: "SECTION",
  BSS: "BSS",
  BSS_C: "BSS_C",
  BSS_F: "BSS_F",
  CSEG: "CSEG",
  CODE: "CODE",
  CODE_C: "CODE_C",
  CODE_F: "CODE_F",
  DATA: "DATA",
  DATA_C: "DATA_C",
  DATA_F: "DATA_F",
  DSEG: "DSEG",
  // Assignements:
  EQU: "EQU",
  FEQU: "FEQU",
  "=": "=",
  SET: "SET",
  // Imports:
  INCLUDE: "INCLUDE",
  INCDIR: "INCDIR",
  INCBIN: "INCBIN",
  // Conditions:
  IF: "IF",
  ELSEIF: "ELSEIF",
  IFEQ: "IFEQ",
  IFNE: "IFNE",
  IFGT: "IFGT",
  IFGE: "IFGE",
  IFLT: "IFLT",
  IFLE: "IFLE",
  IFB: "IFB",
  IFNB: "IFNB",
  IFC: "IFC",
  IFNC: "IFNC",
  IFD: "IFD",
  IFND: "IFND",
  IFMACROD: "IFMACROD",
  IFMACROND: "IFMACROND",
  ELSE: "ELSE",
  ENDC: "ENDC",
  ENDIF: "ENDIF",
  // Macro:
  MACRO: "MACRO",
  ENDM: "ENDM",
  // Repeat:
  REPT: "REPT",
  ENDR: "ENDR",
  // Alignment:
  ALIGN: "ALIGN",
  EVEN: "EVEN",
  ODD: "ODD",
  CNOP: "CNOP",
  // Other:
  OPT: "OPT",
  CARGS: "CARGS",
  CLRFO: "CLRFO",
  CLRSO: "CLRSO",
  COMM: "COMM",
  COMMENT: "COMMENT",
  ECHO: "ECHO",
  EINLINE: "EINLINE",
  END: "END",
  ENDF: "ENDF",
  ENDP: "ENDP",
  EREM: "EREM",
  FAIL: "FAIL",
  FPU: "FPU",
  IDNT: "IDNT",
  INLINE: "INLINE",
  JUMPPTR: "JUMPPTR",
  LIST: "LIST",
  LLEN: "LLEN",
  LOAD: "LOAD",
  MACHINE: "MACHINE",
  MEXIT: "MEXIT",
  MMU: "MMU",
  NOLIST: "NOLIST",
  NOPAGE: "NOPAGE",
  NREF: "NREF",
  OFFSET: "OFFSET",
  OPWORD: "OPWORD",
  ORG: "ORG",
  OUTPUT: "OUTPUT",
  PAGE: "PAGE",
  PLEN: "PLEN",
  PRINTT: "PRINTT",
  PRINTV: "PRINTV",
  PUBLIC: "PUBLIC",
  RECORD: "RECORD",
  REM: "REM",
  RORG: "RORG",
  RSRESET: "RSRESET",
  RSSET: "RSSET",
  SETFO: "SETFO",
  SETSO: "SETSO",
  SPC: "SPC",
  TEXT: "TEXT",
  TTL: "TTL",
  WEAK: "WEAK",
  XDEF: "XDEF",
  XREF: "XREF",
} as const;

export type Directive = Values<typeof Directives>;
export function isDirective(v: string): v is Directive {
  return Directives[v as Directive] !== undefined;
}

/**
 * Map alternate to canonical mnemonics used in our mappings.
 */
export const aliases: Record<string, string> = {
  // Non-standard mnemonics, read the way every other tool here reads them.
  ...Object.fromEntries(
    ["BLO", "DBLO", "SLO", "DBRA", "BHS", "DBHS", "SHS"].map((name) => [
      name,
      canonicalConditionMnemonic(name).toUpperCase(),
    ]),
  ),
  BLK: Directives.DCB,
};

/** These CPUs currently expose only cached instruction reference costs. */
export const cachedOnlyCpu = (cpu: Cpu): boolean =>
  cpu === Cpus.MC68040 || cpu === Cpus.MC68060;
