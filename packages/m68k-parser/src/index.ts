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
export { evaluateConstant, type EvaluateOptions } from "./evaluate.js";
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

export {
  childNodes,
  descendants,
  isAstNode,
  lineNodes,
  walkFile,
  walkLine,
} from "./ast-walk.js";
export type { AstNode } from "./ast-walk.js";
export {
  containsPosition,
  containsRange,
  isBeforeOrEqual,
  locationAsRange,
} from "./geometry.js";
export type { TextPosition, TextRange } from "./geometry.js";

export {
  analyzeLocalLabelScopes,
  bareLocalName,
  isLocalLabelName,
  symbolKey,
} from "./labels.js";
export type { LocalLabelScopes } from "./labels.js";

export { addressingMode } from "./addressing-mode.js";
export type { AddressingModeName } from "./addressing-mode.js";

export {
  addressRegisterForm,
  canonicalConditionMnemonic,
} from "./mnemonic-aliases.js";

export {
  isBlockDirective,
  isSectionDirective,
  sectionTypeNames,
} from "./directive-kinds.js";

export { directiveSize } from "./directive-size.js";
export { expandInlineStatements } from "./inline-statements.js";
export { decodeStringEscapes, type EscapedString } from "./string-escapes.js";
export type { DirectiveSizeOptions } from "./directive-size.js";
