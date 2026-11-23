import type { RegisterAccess } from "@m68k-lsp/protocol";
import {
  canonicalConditionMnemonic,
  type ParsedLine,
  parseLine,
  parseRegisterList,
} from "m68k-parser";
import { type AstNode, descendants } from "./ast";
import { symbolsCaseSensitive } from "./config";
import type { Context } from "./context";
import { expansionFlow } from "./registerFlow";
import {
  canonicalGeneralPurposeRegister,
  expandMacroCall,
} from "./registerSource";
import { DefinitionType, resolveDefinitionByName } from "./symbols";

const registerNodeTypes = new Set([
  "data-register",
  "address-register",
  "special-register",
  "fpu-data-register",
  "fpu-control-register",
]);

const readOnlyDestinations = new Set([
  "btst",
  "chk",
  "chk2",
  "cmp",
  "cmp2",
  "cmpa",
  "cmpi",
  "cmpm",
  "jmp",
  "jsr",
  "pea",
  "tst",
]);

const writeOnlyDestinations = new Set([
  "clr",
  "lea",
  "move",
  "movea",
  "moveq",
  "movep",
  "sf",
  "st",
  "scc",
  "scs",
  "seq",
  "sge",
  "sgt",
  "shi",
  "sle",
  "sls",
  "slt",
  "smi",
  "sne",
  "spl",
  "svc",
  "svs",
]);

/**
 * What one step of execution does to a register: how many low-order bits of
 * its current value it reads, and how many it replaces (8, 16 or 32; 0 for
 * none). The read happens before the write.
 */
interface RegisterEffect {
  read: number;
  write: number;
  /** The line may change the register, even where `write` is 0. */
  modifies?: boolean;
}

/**
 * The register effects of a line, in execution order: one step for an
 * instruction, one per expanded line for a macro call. `unknown` stands for
 * code that could not be expanded, which may do anything.
 */
export type LineSteps = (Map<string, RegisterEffect> | "unknown")[];

/** Register effects of a line, in execution order (see `LineSteps`). */
export function lineSteps(
  ctx: Context,
  uri: string,
  line: ParsedLine,
  lineText: string,
  inMacroDefinition: boolean,
  inConditional: boolean,
  aliases: AliasResolver,
): LineSteps {
  // A macro body runs where the macro is called, not where it is defined.
  if (inMacroDefinition) {
    return [];
  }
  if (line.mnemonic?.type === "macro") {
    const expansion = expandMacroCall(ctx, uri, line, lineText);
    if (expansion) {
      const steps: LineSteps = [];
      // Branches inside the expansion are not followed, so where it has any,
      // none of its writes is certain to happen.
      const branching = expansionFlow(
        expansion,
        symbolsCaseSensitive(ctx.config),
      ).hasFlow;
      let conditionalDepth = 0;
      for (const expanded of expansion.lines) {
        const directive =
          expanded.line.mnemonic?.type === "directive"
            ? expanded.line.mnemonic.directive.toLowerCase()
            : undefined;
        if (directive && directive !== "iif" && directive.startsWith("if")) {
          conditionalDepth++;
        } else if (directive === "endc" || directive === "endif") {
          conditionalDepth = Math.max(0, conditionalDepth - 1);
        }
        if (!expanded.expandedCall) {
          steps.push(
            lineEffects(
              expanded.line,
              inConditional || branching || conditionalDepth > 0,
              aliases,
            ),
          );
          // Subroutines called from inside a macro are not followed.
          const mnemonic =
            expanded.line.mnemonic?.type === "instruction"
              ? expanded.line.mnemonic.instruction.toLowerCase()
              : undefined;
          if (mnemonic === "bsr" || mnemonic === "jsr") {
            steps.push("unknown");
          }
          // A nested call whose definition could not be found.
          if (expanded.line.mnemonic?.type === "macro") {
            steps.push("unknown");
          }
        }
      }
      if (expansion.incomplete) {
        steps.push("unknown");
      }
      return steps;
    }
    // A call to a macro with no definition the workspace can find may use any
    // register; the ones it is passed are taken as read.
    return [lineEffects(line, inConditional, aliases), "unknown"];
  }
  return [lineEffects(line, inConditional, aliases)];
}

/**
 * What a single line does to each register it names: the bits it reads and
 * replaces (see `RegisterEffect`). A write that may not happen, under `iif`
 * or in an `if` block, replaces nothing.
 */
function lineEffects(
  line: ParsedLine,
  inConditional: boolean,
  aliases: AliasResolver,
): Map<string, RegisterEffect> {
  const effects = new Map<string, RegisterEffect>();
  if (definesRegisters(line)) {
    return effects;
  }
  const conditional = inConditional || line.inlineCondition !== undefined;
  const operands = (line.operands ?? []) as AstNode[];
  for (const [operandIndex, operand] of operands.entries()) {
    for (const found of [operand, ...descendants(operand)].flatMap((node) =>
      registersAt(node, aliases),
    )) {
      const { node, registers } = found;
      const access = registerAccess(node, line);
      for (const register of registers) {
        const bits = accessBits(
          line,
          operand,
          node,
          operandIndex === operands.length - 1,
          register,
        );
        const read = access === "write" ? 0 : bits.read;
        const write =
          (access === "write" || access === "readwrite") && !conditional
            ? bits.write
            : 0;
        const previous = effects.get(register);
        effects.set(register, {
          modifies:
            !!previous?.modifies ||
            access === "write" ||
            access === "readwrite",
          read: Math.max(previous?.read ?? 0, read),
          // Two writes on one line are not expected; keep the narrower.
          write:
            previous?.write && write
              ? Math.min(previous.write, write)
              : (previous?.write ?? 0) || write,
        });
      }
    }
  }
  return effects;
}

const qualifierBits: Partial<Record<string, number>> = {
  b: 8,
  w: 16,
  l: 32,
  s: 32,
};

/** Instructions that operate on a whole data register whatever their size. */
const longRegisterInstructions = new Set([
  "bchg",
  "bclr",
  "bset",
  "btst",
  "exg",
  "lea",
  "moveq",
  "swap",
]);

/** Instructions that only ever write a byte. */
const byteWriteInstructions = new Set(["abcd", "nbcd", "sbcd", "tas"]);

/**
 * How many low-order bits of a register an operand reads and replaces.
 *
 * Address registers are always used and written whole: word writes to them
 * are sign-extended. A register inside an addressing mode is an address, read
 * whole, or an index, read at its index size (a word by default). A data
 * register operand is read and written at the operation size, which is a word
 * when the source gives none, with these exceptions: MOVEM loads and the
 * destination of a word MULU/MULS are sign- or zero-extended to the whole
 * register, a word DIVU/DIVS reads the whole dividend, DBcc counts in a word,
 * Scc and the BCD instructions write a byte, and some instructions always
 * work on all 32 bits. A size the register cannot have reads it whole and
 * replaces nothing.
 */
function accessBits(
  line: ParsedLine,
  operand: AstNode,
  node: AstNode,
  destination: boolean,
  register: string,
): RegisterEffect {
  if (register.startsWith("a")) {
    return { read: 32, write: 32 };
  }
  if (node !== operand) {
    const index = [operand, ...descendants(operand)].find(
      (item) =>
        (item as AstNode & { indexRegister?: unknown }).indexRegister === node,
    ) as (AstNode & { indexSize?: AstNode & { size?: string } }) | undefined;
    if (index) {
      return {
        read: index.indexSize?.size?.toLowerCase() === "l" ? 32 : 16,
        write: 0,
      };
    }
    return { read: 32, write: 0 };
  }

  const mnemonic =
    line.mnemonic?.type === "instruction"
      ? canonicalConditionMnemonic(line.mnemonic.instruction).toLowerCase()
      : undefined;
  if (!mnemonic) {
    return { read: 32, write: 0 };
  }
  const qualifier =
    line.qualifier?.type === "size"
      ? line.qualifier.size.toLowerCase()
      : undefined;
  const size = qualifier === undefined ? 16 : qualifierBits[qualifier];
  if (size === undefined) {
    return { read: 32, write: 0 };
  }
  if (longRegisterInstructions.has(mnemonic) || mnemonic.startsWith("bf")) {
    return { read: 32, write: 32 };
  }
  if (mnemonic === "movem") {
    return { read: size, write: 32 };
  }
  if (mnemonic.startsWith("db")) {
    return { read: 16, write: 16 };
  }
  if (destination && size === 16) {
    if (mnemonic === "divu" || mnemonic === "divs") {
      return { read: 32, write: 32 };
    }
    if (mnemonic === "mulu" || mnemonic === "muls") {
      return { read: 16, write: 32 };
    }
  }
  if (byteWriteInstructions.has(mnemonic) || /^s(?!ub|wap)/.test(mnemonic)) {
    return { read: size, write: 8 };
  }
  return { read: size, write: size };
}

export function registerName(node: AstNode) {
  const register = (node as AstNode & { register?: unknown }).register;
  if (!registerNodeTypes.has(node.type) || typeof register !== "string") {
    return;
  }
  return register.toLowerCase();
}

/** The kinds of node that name general-purpose registers. */
interface NodeRegisters {
  /** The node standing for the registers, whose access they share. */
  node: AstNode;
  registers: string[];
  kind: "explicit" | "register-list" | "alias";
}

/**
 * Names `equr`/`equrl`/`reg` aliases resolve to, as general-purpose
 * registers, or undefined for a name that is not such an alias.
 */
export type AliasResolver = (name: string) => string[] | undefined;

/**
 * Resolves register aliases through the symbols visible from a document,
 * remembering each answer.
 */
export function createAliasResolver(ctx: Context, uri: string): AliasResolver {
  const cache = new Map<string, string[] | undefined>();
  return (name) => {
    if (!cache.has(name)) {
      const definition = resolveDefinitionByName(uri, name, ctx);
      cache.set(
        name,
        (definition?.type === DefinitionType.Register ||
          definition?.type === DefinitionType.RegisterList) &&
          definition.declaration
          ? aliasedRegisters(definition.declaration)
          : undefined,
      );
    }
    return cache.get(name);
  };
}

/**
 * The general-purpose registers an alias definition line names, such as `d0`
 * in `count equr d0` or the list in `saved reg d2-d3/a2`. Directive operands
 * parse as expressions, so the operand's text is read as a register list.
 */
function aliasedRegisters(declaration: string): string[] | undefined {
  const operand = parseLine(declaration).value.operands?.[0];
  if (!operand) {
    return;
  }
  const registers = parseRegisterList(
    declaration.slice(operand.loc.start, operand.loc.end),
  );
  return registers?.length
    ? registers.map((register) => canonicalGeneralPurposeRegister(register)!)
    : undefined;
}

function listedRegisters(node: AstNode): string[] {
  const registers = (node as AstNode & { registers?: unknown }).registers;
  return Array.isArray(registers)
    ? registers.flatMap((item) => canonicalGeneralPurposeRegister(item) ?? [])
    : [];
}

/**
 * The general-purpose registers a node names: a register, a register list, or
 * an alias for either. An alias is only taken where a register can stand: as a
 * whole operand, such as `count` in `move.w count,d1`, or as an addressing
 * mode's base or index register, such as `ptr` in `(ptr)+`.
 */
export function registersAt(
  node: AstNode,
  aliases: AliasResolver,
): NodeRegisters[] {
  const single = canonicalGeneralPurposeRegister(registerName(node));
  if (single) {
    return [{ node, registers: [single], kind: "explicit" }];
  }
  if (node.type === "register-list") {
    const registers = listedRegisters(node);
    return registers.length ? [{ node, registers, kind: "register-list" }] : [];
  }
  const found: NodeRegisters[] = [];
  const fields = node as AstNode & {
    address?: AstNode & { name?: unknown };
    addressSize?: unknown;
    register?: unknown;
    baseRegister?: unknown;
    indexRegister?: unknown;
  };
  if (
    node.type === "absolute-address" &&
    fields.address?.type === "symbol" &&
    fields.addressSize === undefined &&
    typeof fields.address.name === "string"
  ) {
    const registers = aliases(fields.address.name);
    if (registers) {
      found.push({ node, registers, kind: "alias" });
    }
  }
  for (const value of [
    fields.register,
    fields.baseRegister,
    fields.indexRegister,
  ]) {
    const symbol = value as (AstNode & { name?: unknown }) | undefined;
    if (symbol?.type === "symbol" && typeof symbol.name === "string") {
      const registers = aliases(symbol.name);
      if (registers) {
        found.push({ node: symbol, registers, kind: "alias" });
      }
    }
  }
  return found;
}

/** Directives that define register aliases rather than use registers. */
const registerDefinitionDirectives = new Set([
  "equr",
  "equrl",
  "fequr",
  "fequrl",
  "freg",
  "reg",
]);

export function definesRegisters(line: ParsedLine): boolean {
  return (
    line.mnemonic?.type === "directive" &&
    registerDefinitionDirectives.has(line.mnemonic.directive.toLowerCase())
  );
}

export function registerAccess(
  node: AstNode,
  line: ParsedLine,
): RegisterAccess {
  // The synonym spellings (SHS, SLO, DBRA) are the instructions they stand for.
  const mnemonic =
    line.mnemonic?.type === "instruction"
      ? canonicalConditionMnemonic(line.mnemonic.instruction)
      : undefined;
  const operands = line.operands ?? [];
  const operandIndex = operands.findIndex((operand) =>
    containsLocation(operand.loc, node.loc),
  );
  if (!mnemonic || operandIndex < 0) {
    return "unknown";
  }

  const operand = operands[operandIndex] as AstNode;
  if (operand !== node) {
    return operand.type === "address-register-indirect-postinc" ||
      operand.type === "address-register-indirect-predec"
      ? "readwrite"
      : "read";
  }

  if (mnemonic === "movem") {
    return operandIndex === 0 ? "read" : "write";
  }
  if (mnemonic === "exg" || mnemonic === "link" || mnemonic.startsWith("db")) {
    return "readwrite";
  }
  if (operandIndex < operands.length - 1) {
    return "read";
  }
  if (readOnlyDestinations.has(mnemonic)) {
    return "read";
  }
  if (writeOnlyDestinations.has(mnemonic)) {
    return "write";
  }
  return "readwrite";
}

function containsLocation(
  container: AstNode["loc"],
  item: AstNode["loc"],
): boolean {
  return container.start <= item.start && item.end <= container.end;
}
