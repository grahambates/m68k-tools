// Import and re-export register types from syntax (derived from const arrays)
import type {
  DataRegister,
  AddressRegister,
  SpecialRegister,
  FPUDataRegister,
  FPUControlRegister,
  FPURegister,
  BuiltinSymbol,
  Instruction,
  Directive,
  Size,
  AddressSize,
  BinaryOp,
  UnaryOp,
  SectionType,
  MemoryType,
} from "./syntax.js";
import type { ParseError, ParseErrorCode } from "./parse-error.js";

export type {
  DataRegister,
  AddressRegister,
  SpecialRegister,
  FPUDataRegister,
  FPUControlRegister,
  FPURegister,
  BuiltinSymbol,
  Instruction,
  Directive,
  Size,
  AddressSize,
  BinaryOp,
  UnaryOp,
  SectionType,
  MemoryType,
  ParseError,
  ParseErrorCode,
};

// Resilient parse result - always returns a value with optional errors
export type ParserResult<T> = {
  value: T;
  errors: ParseError[];
};

export type MnemonicNode =
  InstructionNode | DirectiveNode | MacroNode | MacroParameterNode;

/**
 * A size qualifier. `UnknownNode` covers a dot that is not followed by a
 * recognised size, either because it is still being typed (`move.`) or because
 * the size is not one the parser knows (`move.z`). Its location spans the text
 * after the dot, which is empty in the first case.
 */
export type QualifierNode = SizeNode | MacroParameterNode | UnknownNode;

export interface ParsedLine {
  lineNumber?: number;
  inlineCondition?: ExpressionNode; // For iif directive: the condition expression
  label?: LabelNode;
  mnemonic?: MnemonicNode;
  qualifier?: QualifierNode;
  operands?: OperandNode[];
  comment?: CommentNode;
}

export type BlockKind = "macro" | "repeat" | "conditional";

/**
 * A macro definition, repeat or conditional block.
 *
 * `start`, `end` and `alternatives` are indices into `ParsedFile.lines`,
 * counted from zero, rather than the one-based `Location.line`.
 */
export interface Block {
  kind: BlockKind;
  /** Line opening the block. */
  start: number;
  /** Line closing it, absent when the block is never terminated. */
  end?: number;
  /** Name of a macro definition, taken from its label. */
  name?: string;
  /** `else` and `elseif` lines, in order. Conditionals only. */
  alternatives: number[];
  /** Blocks nested directly inside this one, in source order. */
  children: Block[];
}

export interface BlockStructure {
  /** Blocks at file level, in source order. */
  blocks: Block[];
  /** Unterminated blocks and terminators that match nothing. */
  errors: ParseError[];
}

export interface ParsedFile {
  lines: ParsedLine[]; // All lines in the file
  errors: ParseError[];
}

/**
 * `float` covers a literal written with a decimal point, as accepted by the
 * floating point directives `dc.s`, `dc.d`, `dc.x`, `dc.p` and by `fequ`.
 * Whether one is meaningful where it appears is for the caller to judge:
 * `dc.b 1.5` parses as a float but is not valid data for a byte.
 */
export type NumberFormat = "decimal" | "hex" | "binary" | "octal" | "float";

// Location information for AST nodes
export interface Location {
  /** Start column */
  start: number;
  /** End column */
  end: number;
  /** Line number (1-based) */
  line?: number;
}

// Base node - all AST nodes extend this
export interface Node {
  loc: Location;
}

// Label
export interface LabelNode extends Node {
  type: "label";
  scope: "global" | "local" | "external";
  label: string;
  /**
   * True when the label embeds a macro placeholder, as in `.loop\@`, making
   * it a per-expansion name rather than a single definition.
   */
  interpolated?: boolean;
}

// CPU Instruction (e.g., move, add, bra)
export interface InstructionNode extends Node {
  type: "instruction";
  instruction: string;
}

// Directive (e.g., dc, ds, equ)
export interface DirectiveNode extends Node {
  type: "directive";
  directive: string;
}

// Macro invocation
export interface MacroNode extends Node {
  type: "macro";
  macro: string;
}

// Size qualifier
export interface SizeNode extends Node {
  type: "size";
  size: Size;
}

// Comment
export interface CommentNode extends Node {
  type: "comment";
  hasPrefix: boolean; // true if starts with ; or *
  content: string; // The comment text without the prefix
}

// Expression node types
export type ExpressionNode =
  | NumericLiteralNode
  | SymbolNode
  | BuiltinSymbolNode
  | BinaryOperatorNode
  | UnaryOperatorNode
  | GroupNode
  | CurrentAddressNode
  | MacroParameterExpressionNode
  | StringLiteralNode
  | UnknownNode;

// Numeric literal in an expression
export interface NumericLiteralNode extends Node {
  type: "numeric-literal";
  format: NumberFormat;
  raw: string;
  value: number;
}

// Symbol/identifier reference
export interface SymbolNode extends Node {
  type: "symbol";
  name: string; // The identifier name like "label" or "MYCONST"
  /**
   * True when the name embeds a macro placeholder, as in `BLTEN_\1` or
   * `.loop\@`. Such a name is a template resolved when the macro expands,
   * so it does not refer to any symbol as written.
   */
  interpolated?: boolean;
}

// Built-in assembler symbols
export interface BuiltinSymbolNode extends Node {
  type: "builtin-symbol";
  name: BuiltinSymbol;
}

// Binary operation
export interface BinaryOperatorNode extends Node {
  type: "binary-op";
  operator: BinaryOp;
  left: ExpressionNode;
  right: ExpressionNode;
}

// Unary operation
export interface UnaryOperatorNode extends Node {
  type: "unary-op";
  operator: UnaryOp;
  operand: ExpressionNode;
}

// Grouped expression
export interface GroupNode extends Node {
  type: "group";
  expression: ExpressionNode;
}

// Current address (*)
export interface CurrentAddressNode extends Node {
  type: "current-address";
}

// Macro parameter in expression (\1, \@, \<name>)
export interface MacroParameterExpressionNode extends Node {
  type: "macro-parameter";
  paramType: "numeric" | "special" | "named";
  param: string;
}

// Operand types (addressing modes)
export type OperandNode =
  | DataRegisterNode
  | AddressRegisterNode
  | SpecialRegisterNode
  | FPUDataRegisterNode
  | FPUControlRegisterNode
  | RegisterListNode
  | FPURegisterListNode
  | ImmediateNode
  | AddressRegisterIndirectNode
  | AddressRegisterIndirectPostIncNode
  | AddressRegisterIndirectPreDecNode
  | AddressRegisterIndirectDisplacementNode
  | AddressRegisterIndirectIndexNode
  | MemoryIndirectNode
  | AbsoluteAddressNode
  | PCRelativeNode
  | PCRelativeIndexNode
  | BitfieldNode
  | RegisterPairNode
  | StringLiteralNode
  | MacroParameterNode
  | ValueNode
  | MacroArgumentNode
  | SectionTypeNode
  | MemoryTypeNode
  | OptOptionNode
  | UnknownNode;

// Data register operand (d0-d7)
export interface DataRegisterNode extends Node {
  type: "data-register";
  register: DataRegister;
}

// Address register operand (a0-a7, sp)
export interface AddressRegisterNode extends Node {
  type: "address-register";
  register: AddressRegister;
}

// Special/system register operand (sr, ccr, usp, ssp, pc, etc.)
export interface SpecialRegisterNode extends Node {
  type: "special-register";
  register: SpecialRegister;
}

// FPU data register operand (fp0-fp7)
export interface FPUDataRegisterNode extends Node {
  type: "fpu-data-register";
  register: FPUDataRegister;
}

// FPU control register operand (fpcr, fpsr, fpiar)
export interface FPUControlRegisterNode extends Node {
  type: "fpu-control-register";
  register: FPUControlRegister;
}

// Register list (d0-d7/a0-a6, used in movem, etc.)
export interface RegisterListNode extends Node {
  type: "register-list";
  raw: string[]; // Original specs like ['d0-d7', 'a0-a6']
  registers: (DataRegister | AddressRegister)[]; // Expanded list: ['d0', 'd1', ..., 'd7', 'a0', ...]
}

// FPU register list (fp0-fp7, used in fmovem)
export interface FPURegisterListNode extends Node {
  type: "fpu-register-list";
  raw: string[]; // Original specs like ['fp0-fp7', 'fp1-fp3']
  registers: FPUDataRegister[]; // Expanded list: ['fp0', 'fp1', ..., 'fp7']
}

// Macro parameter (\1, \@, \<name>, \a-\z, \?n, \., \+, \-, \@!, \@?, \@@)
export interface MacroParameterNode extends Node {
  type: "macro-parameter";
  paramType:
    | "numeric" // \1-\9
    | "letter" // \a-\z (args 10-35)
    | "special" // \@
    | "named" // \<name>
    | "query" // \?n (length of arg n)
    | "carg" // \. (current), \+ (inc), \- (dec)
    | "unique-push" // \@! (push unique ID and insert)
    | "unique-push-below" // \@? (push below top and insert)
    | "unique-pull"; // \@@ (pull from stack and insert)
  param: string; // The parameter identifier
}

// Immediate value (#123, #$FF, #'f' etc.)
export interface ImmediateNode extends Node {
  type: "immediate";
  value: ExpressionNode | StringLiteralNode; // Parsed expression (the part after #)
}

// Address register indirect: (a0)
export interface AddressRegisterIndirectNode extends Node {
  type: "address-register-indirect";
  register: AddressRegisterNode | SymbolNode | MacroParameterNode;
}

// Address register indirect post-increment: (a0)+
export interface AddressRegisterIndirectPostIncNode extends Node {
  type: "address-register-indirect-postinc";
  register: AddressRegisterNode | SymbolNode | MacroParameterNode;
}

// Address register indirect pre-decrement: -(a0)
export interface AddressRegisterIndirectPreDecNode extends Node {
  type: "address-register-indirect-predec";
  register: AddressRegisterNode | SymbolNode | MacroParameterNode;
}

// Address register indirect with displacement: 10(a0), offset(a0)
export interface AddressRegisterIndirectDisplacementNode extends Node {
  type: "address-register-indirect-displacement";
  displacement: ExpressionNode; // Parsed displacement expression
  register: AddressRegisterNode | SymbolNode | MacroParameterNode;
}

// Address register indirect with index: 10(a0,d1.w) or 10(a0,d1.w*2)
export interface AddressRegisterIndirectIndexNode extends Node {
  type: "address-register-indirect-index";
  displacement?: ExpressionNode; // Parsed displacement expression
  baseRegister: AddressRegisterNode | SymbolNode | MacroParameterNode;
  indexRegister:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode
    | UnknownNode;
  indexSize?: SizeNode | MacroParameterNode | UnknownNode;
  scaleFactor?: ExpressionNode; // 68020+ scale factor (e.g., 2, 4, foo+1)
}

// Absolute address: $1000, label, (addr).w, (addr).l
export interface AbsoluteAddressNode extends Node {
  type: "absolute-address";
  address: ExpressionNode; // Parsed expression
  addressSize?: SizeNode | MacroParameterNode | UnknownNode;
}

// PC relative: offset(pc)
export interface PCRelativeNode extends Node {
  type: "pc-relative";
  displacement: ExpressionNode; // Parsed displacement expression
}

// PC relative: offset(pc,d0) or offset(pc,d0.w*2)
export interface PCRelativeIndexNode extends Node {
  type: "pc-relative-index";
  displacement?: ExpressionNode; // Parsed displacement expression
  indexRegister:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode
    | UnknownNode;
  indexSize?: SizeNode | MacroParameterNode | UnknownNode;
  scaleFactor?: ExpressionNode; // 68020+ scale factor (e.g., 2, 4, foo+1)
}

// String literal: "text", 'text', <text>
export interface StringLiteralNode extends Node {
  type: "string-literal";
  quote?: '"' | "'" | "<>";
  content: string;
}

// Value operand (for directives and macros - numeric literals, constants, expressions)
export interface ValueNode extends Node {
  type: "value";
  value: ExpressionNode; // Parsed expression
}

/**
 * An argument to a macro call that is not an expression.
 *
 * Macro arguments are substituted textually, so they need not be valid
 * operands on their own: `BITDEF MEM,24BITDMA,9` passes `24BITDMA`, which
 * cannot be an identifier because it starts with a digit. Used only where the
 * text does not parse as an expression in full, so ordinary arguments keep
 * their structure.
 */
export interface MacroArgumentNode extends Node {
  type: "macro-argument";
  text: string;
}

// Memory indirect addressing (68020+): ([bd,An,Rn.s*scale],od)
export interface MemoryIndirectNode extends Node {
  type: "memory-indirect";
  baseDisplacement?: ExpressionNode; // [bd,...]
  baseRegister?: AddressRegisterNode | SymbolNode | MacroParameterNode; // [bd,An,...]
  indexRegister?:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode
    | UnknownNode; // [bd,An,Rn,...]
  indexSize?: SizeNode | MacroParameterNode | UnknownNode;
  scaleFactor?: ExpressionNode; // 68020+ scale factor (e.g., 2, 4, foo+1)
  outerDisplacement?: ExpressionNode; // [...],od
  /**
   * Where the index register is applied, when there is one:
   * - "pre":  preindexed,  ([bd,An,Xn],od) - index applied before the memory fetch
   * - "post": postindexed, ([bd,An],Xn,od) - index applied after the memory fetch
   */
  indexPosition?: "pre" | "post";
}

// Bitfield specification (68020+): <ea>{offset:width}
export interface BitfieldNode extends Node {
  type: "bitfield";
  /**
   * The effective address the bitfield applies to, e.g. `d0` in `d0{4:8}`.
   * Undefined when the bitfield is written on its own as `{offset:width}`.
   */
  base?: OperandNode;
  offset: DataRegisterNode | ExpressionNode; // Offset or Dn holding it
  width?: DataRegisterNode | ExpressionNode; // Width or Dn holding it (optional, defaults to 1)
}

/**
 * Register pair joined with a colon (68020+):
 * - `Dh:Dl` / `Dr:Dq` for 64-bit mulu.l/muls.l/divu.l/divs.l/divul.l/divsl.l
 * - `Dc1:Dc2`, `Du1:Du2` and `(Rn1):(Rn2)` for cas2
 */
export interface RegisterPairNode extends Node {
  type: "register-pair";
  first: OperandNode;
  second: OperandNode;
}

export interface SectionTypeNode extends Node {
  type: "section-type";
  sectionType: SectionType;
}

export interface MemoryTypeNode extends Node {
  type: "memory-type";
  memoryType: MemoryType;
}

export interface OptOptionNode extends Node {
  type: "opt-option";
  option: string;
  mode?: "enable" | "disable";
}

// Unknown/incomplete
export interface UnknownNode extends Node {
  type: "unknown";
}
