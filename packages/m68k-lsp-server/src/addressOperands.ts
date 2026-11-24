import type { ExpressionNode, ParsedLine } from "m68k-parser";
import type { AstNode } from "./ast";
import type { Context } from "./context";
import type { ProcessedDocument } from "./DocumentProcessor";
import {
  createAliasResolver,
  lineSteps,
  registerName,
  type AliasResolver,
} from "./registerEffects";
import {
  collectMacroDefinitionLines,
  isNonLocalCodeLabel,
} from "./registerSource";

/** An expression's value, where it is known. */
export type Evaluate = (expr: ExpressionNode) => number | undefined;

/** How far back to look for what an address register was loaded with. */
const SCAN_LIMIT = 400;

/** Registers a called routine may change: the usual scratch registers. */
const scratch = new Set(["a0", "a1"]);

/**
 * Works out the addresses operands refer to in one document: absolute
 * addresses, and an address register's value plus a displacement where the
 * routine loads it with a known address, `lea $dff000,a6` and then
 * `$96(a6)`.
 */
export class AddressResolver {
  private readonly aliases: AliasResolver;
  private readonly lineTexts: string[];
  private readonly inMacroDefinition: Set<number>;
  private readonly cache = new Map<string, number | undefined>();

  constructor(
    private readonly ctx: Context,
    private readonly processed: ProcessedDocument,
    private readonly evaluate: Evaluate,
  ) {
    this.aliases = createAliasResolver(ctx, processed.uri);
    this.lineTexts = processed.document.getText().split(/\r?\n/);
    this.inMacroDefinition = collectMacroDefinitionLines(
      processed.blocks.blocks,
    );
  }

  /** The address an operand on a line refers to, where it is known. */
  operandAddress(
    lineIndex: number,
    operand: NonNullable<ParsedLine["operands"]>[number],
  ): number | undefined {
    if (this.inMacroDefinition.has(lineIndex)) return undefined;
    switch (operand.type) {
      case "absolute-address": {
        const value = this.evaluate(operand.address);
        if (value === undefined) return undefined;
        // An absolute short address is sign-extended.
        const short =
          operand.addressSize?.type === "size" &&
          operand.addressSize.size.toLowerCase() === "w";
        return short ? ((value << 16) >> 16) >>> 0 : value >>> 0;
      }
      case "address-register-indirect": {
        const register = this.register(operand.register as AstNode);
        return register ? this.registerValue(lineIndex, register) : undefined;
      }
      case "address-register-indirect-displacement": {
        const register = this.register(operand.register as AstNode);
        const base = register
          ? this.registerValue(lineIndex, register)
          : undefined;
        const displacement = this.evaluate(operand.displacement);
        return base === undefined || displacement === undefined
          ? undefined
          : (base + displacement) >>> 0;
      }
      default:
        return undefined;
    }
  }

  private register(node: AstNode): string | undefined {
    const name = registerName(node);
    if (name) return name;
    if (node.type !== "symbol") return undefined;
    const aliased = this.aliases((node as unknown as { name: string }).name);
    return aliased?.length === 1 ? aliased[0] : undefined;
  }

  /**
   * What an address register holds on a line: the address the routine last
   * loaded it with by `lea address,An` or `move.l #address,An`, looking back
   * to the start of the routine. Unknown where anything else may have
   * changed it on the way, a call for A0 and A1 included.
   */
  registerValue(lineIndex: number, register: string): number | undefined {
    const key = `${lineIndex}:${register}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const value = this.scan(lineIndex, register);
    this.cache.set(key, value);
    return value;
  }

  private scan(lineIndex: number, register: string): number | undefined {
    const { lines } = this.processed.parsed;
    const stop = Math.max(0, lineIndex - SCAN_LIMIT);
    for (let index = lineIndex - 1; index >= stop; index--) {
      const line = lines[index];
      if (!this.inMacroDefinition.has(index)) {
        const mnemonic =
          line.mnemonic?.type === "instruction"
            ? line.mnemonic.instruction.toLowerCase()
            : undefined;
        if ((mnemonic === "bsr" || mnemonic === "jsr") && scratch.has(register))
          return undefined;
        const steps = lineSteps(
          this.ctx,
          this.processed.uri,
          line,
          this.lineTexts[index] ?? "",
          false,
          false,
          this.aliases,
        );
        for (const step of steps) {
          if (step === "unknown") return undefined;
          const effect = step.get(register);
          if (effect && (effect.write > 0 || effect.modifies))
            return this.loaded(line, register);
        }
      }
      if (isNonLocalCodeLabel(line)) return undefined;
    }
    return undefined;
  }

  /** The address a line loads into a register, where it is a load of one. */
  private loaded(line: ParsedLine, register: string): number | undefined {
    if (line.mnemonic?.type !== "instruction") return undefined;
    const mnemonic = line.mnemonic.instruction.toLowerCase();
    const size =
      line.qualifier?.type === "size"
        ? line.qualifier.size.toLowerCase()
        : undefined;
    const [source, destination] = line.operands ?? [];
    if (!destination || this.register(destination as AstNode) !== register)
      return undefined;
    if (mnemonic === "lea" && source?.type === "absolute-address") {
      const value = this.evaluate(source.address);
      return value === undefined ? undefined : value >>> 0;
    }
    if (
      (mnemonic === "move" || mnemonic === "movea") &&
      size === "l" &&
      source?.type === "immediate" &&
      source.value.type !== "string-literal"
    ) {
      const value = this.evaluate(source.value as ExpressionNode);
      return value === undefined ? undefined : value >>> 0;
    }
    return undefined;
  }
}
