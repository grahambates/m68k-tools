import Parser, { type Line } from "./Parser";
import { type CacheModel, type Cpu } from "../syntax";

export * from "./Parser";
export * from "./nodes";

export interface ParseOptions {
  /** Target CPU model (default 68000) */
  cpu?: Cpu;
  /** Which 68020 cache case to report (default worst) */
  cacheModel?: CacheModel;
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
