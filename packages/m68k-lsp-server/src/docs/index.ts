import instructionsJson from "./instructions.json";
import directivesJson from "./directives.json";
import type { Size } from "m68k-parser";
import { type AddressingMode, type RegisterName } from "../syntax";

export type ConditionCode = "x" | "n" | "z" | "v" | "c";

/**
 * CCR register states
 *
 * U The state of the bit is undefined (i.e., its value cannot be predicted)
 * - The bit remains unchanged by the execution of the instruction
 * * The bit is set or cleared according to the outcome of the instruction.
 */
export type CCState = "-" | "*" | "0" | "U" | "1";

export type ConditionCodes = Record<ConditionCode, CCState>;

/**
 * Supported addressing modes for operand
 */
export type AddressingModes = Record<AddressingMode, boolean>;

export interface MnemonicDoc {
  title: string;
  summary: string;
  syntax: string[];
  description?: string;
}

export interface InstructionDoc extends MnemonicDoc {
  operation?: string;
  ccr?: ConditionCodes;
  conditionCodeDescription?: string;
  // sampleSyntax?: string[];
  // example?: string;
  // application?: string;
  src?: AddressingModes;
  dest?: AddressingModes;
  procs: Processors;
}

export type Processor =
  | "mc68000"
  | "mc68010"
  | "mc68020"
  | "mc68030"
  | "mc68040"
  | "mc68060"
  | "mc68881"
  | "mc68851"
  | "cpu32";

export type Processors = Record<Processor, boolean>;

export const isInstructionDoc = (doc: MnemonicDoc): doc is InstructionDoc =>
  (doc as InstructionDoc).operation !== undefined;

export const instructionDocs = instructionsJson as Record<
  string,
  InstructionDoc
>;
export const directiveDocs = directivesJson as Record<string, MnemonicDoc>;

export const mnemonicDocs = {
  ...instructionDocs,
  ...directiveDocs,
};

export const sizeDocs: Record<Size, string> = {
  b: "Byte (8 bit)",
  w: "Word (16 bit)",
  l: "Long-word (32 bit)",
  q: "Quad-word (64 bit)",
  s: "Single precision (32 bit)",
  d: "Double precision (64 bit)",
  x: "Extended precision (96 bit)",
  p: "Packed decimal (not yet supported in vasm)",
};

export const addressingModeDocs: Record<AddressingMode, string> = {
  dn: "Dn",
  an: "An",
  anIndirect: "(An)",
  anPostInc: "(An)+",
  anPreDec: "-(An)",
  anOffset: "d(An)",
  anIdx: "d(An,Xi)",
  absW: "ABS.W",
  absL: "ABS.L",
  pcOffset: "d(PC)",
  pcIdx: "d(PC,Xn)",
  imm: "imm",
};

export const registerDocs: Record<RegisterName, string> = {
  ccr: "Condition Code Register",
  pc: "Program Counter",
  sr: "Stack Register",
  usp: "User Stack Pointer",
  vbr: "Vector Base Register",
};
