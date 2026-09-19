import Parser, { type Line } from "./Parser";
import { type CacheModel, type Cpu } from "../syntax";

export * from "./Parser";
export * from "./nodes";

export interface ParseOptions {
  /** Target CPU model (default 68000) */
  cpu?: Cpu;
  /** 020/030 cache case (default worst); 040/060 currently always use cached references */
  cacheModel?: CacheModel;
  /**
   * Whether `Foo` and `foo` are different symbols, constants and macros alike
   * (default true, as an assembler has it; false for `vasm -nocase`).
   */
  caseSensitive?: boolean;
}

/**
 * Parse multiple lines of ASM code
 */
export default function parse(
  input: string,
  options: ParseOptions = {},
): Line[] {
  const parser = new Parser(options);
  return parser.parse(input);
}
