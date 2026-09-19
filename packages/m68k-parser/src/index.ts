export type * from "./types.js";

export {
  dataRegisters,
  addressRegisters,
  specialRegisters,
  fpuDataRegisters,
  fpuControlRegisters,
  sizes,
  memoryTypes,
  sectionTypes,
} from "./syntax.js";

export { parseLine } from "./line-parser.js";
export { parseFile } from "./file-parser.js";
export {
  parseBlocks,
  blockAt,
  blockRole,
  enclosingBlocks,
  directiveName,
} from "./block-parser.js";

export { parseExpression } from "./expression-parser.js";
export { evaluateConstant } from "./evaluate.js";
export type { ConstantResult, ConstantResolver } from "./evaluate.js";

export {
  collectMacroDefinitions,
  expandMacro,
  macroInvocation,
  substituteMacroParameters,
} from "./macro-expansion.js";
export type {
  ExpandedMacroLine,
  ExpandedText,
  ExpandOptions,
  ExpansionSpan,
  MacroArgument,
  MacroDefinition,
  MacroExpansion,
  MacroInvocation,
} from "./macro-expansion.js";
