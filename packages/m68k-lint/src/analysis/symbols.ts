import type {
  ExpressionNode,
  MacroDefinition,
  ParsedFile,
  ParsedLine,
} from "m68k-parser";
import { evaluateConstant, type ConstantResult } from "./constants.js";
import { isInMacroDefinition, scanBlocks } from "./blocks.js";

export interface ConstantSymbol {
  name: string;
  normalizedName: string;
  expression: ExpressionNode;
  line: ParsedLine;
  lineIndex: number;
}

export interface SymbolTable {
  getConstant(name: string): ConstantSymbol | undefined;
  evaluate(name: string): ConstantResult;
  entries(): readonly ConstantSymbol[];
  /** Where a resolved value came from, when it was not this file. */
  originOf(name: string): string | undefined;
  externalUses(): readonly ExternalUse[];
  forgetExternalUses(): void;
}

/**
 * Constants gathered from the rest of the project, consulted when this file
 * does not define a name itself.
 */
export interface ExternalSymbols {
  lookup(name: string): { value: number; origin: string } | undefined;
  /**
   * A macro the project defines, for calls this file cannot resolve itself.
   * Answered only where the whole project agrees on one definition.
   */
  macro?(name: string): ExternalMacro | undefined;
}

export interface ExternalMacro {
  definition: MacroDefinition;
  /** Where it is defined, for telling the user. */
  origin: string;
}

/** A constant this file used but did not define. */
export interface ExternalUse {
  name: string;
  value: number;
  origin: string;
}

function normalizeSymbol(name: string): string {
  // Most 68k assembler source treats symbols case-insensitively. If the
  // parser/toolchain later exposes a case-sensitive mode, make this configurable.
  return name.toLowerCase();
}

function expressionOperand(line: ParsedLine): ExpressionNode | undefined {
  const first = line.operands?.[0];
  if (!first) return undefined;

  switch (first.type) {
    case "value":
      return first.value;
    case "absolute-address":
      return first.address;
    default:
      return undefined;
  }
}

export function constantDefinition(
  line: ParsedLine,
): { name: string; expression: ExpressionNode } | undefined {
  if (!line.label || line.mnemonic?.type !== "directive") return undefined;

  const directive = line.mnemonic.directive.toLowerCase();
  if (directive !== "equ" && directive !== "=") return undefined;

  const expression = expressionOperand(line);
  if (!expression) return undefined;

  return {
    name: line.label.label,
    expression,
  };
}

/**
 * Whether two definitions say the same thing. Compared structurally, so
 * repeating an identical `equ` (common where a header is included twice
 * without a guard) is not treated as a conflict.
 */
function sameExpression(a: ExpressionNode, b: ExpressionNode): boolean {
  return (
    JSON.stringify(stripLocations(a)) === JSON.stringify(stripLocations(b))
  );
}

function stripLocations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLocations);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "loc")
        .map(([key, inner]) => [key, stripLocations(inner)]),
    );
  }
  return value;
}

export class DefaultSymbolTable implements SymbolTable {
  private readonly constants = new Map<string, ConstantSymbol>();
  /** Names defined more than once with different expressions, so no single value is theirs. */
  private readonly conflicted = new Set<string>();
  private readonly external?: ExternalSymbols;
  private readonly origins = new Map<string, string>();
  private readonly used = new Map<string, ExternalUse>();

  /**
   * @param skip lines to leave out, such as those in an arm of conditional
   *   assembly that is not assembled
   */
  constructor(
    file: ParsedFile,
    external?: ExternalSymbols,
    skip?: (lineIndex: number) => boolean,
  ) {
    this.external = external;
    const blocks = scanBlocks(file);

    file.lines.forEach((line, lineIndex) => {
      const definition = constantDefinition(line);
      if (!definition || skip?.(lineIndex)) return;
      // A definition inside a macro body belongs to each expansion, not to the
      // file. Taking it as a file-global constant attributed a value to a name
      // that may not exist at all until the macro is invoked, and may differ
      // between invocations.
      if (isInMacroDefinition(blocks, lineIndex)) return;

      const normalizedName = normalizeSymbol(definition.name);
      const existing = this.constants.get(normalizedName);
      if (
        existing &&
        !sameExpression(existing.expression, definition.expression)
      ) {
        // Two different definitions of one name. Which is in force depends on
        // assembly order and conditional arms we cannot evaluate, so the honest
        // answer is that we do not know rather than whichever came last.
        this.conflicted.add(normalizedName);
        return;
      }
      this.constants.set(normalizedName, {
        name: definition.name,
        normalizedName,
        expression: definition.expression,
        line,
        lineIndex,
      });
    });
  }

  getConstant(name: string): ConstantSymbol | undefined {
    const normalized = normalizeSymbol(name);
    return this.conflicted.has(normalized)
      ? undefined
      : this.constants.get(normalized);
  }

  evaluate(name: string): ConstantResult {
    return this.evaluateInternal(name, new Set());
  }

  entries(): readonly ConstantSymbol[] {
    return [...this.constants.values()].filter(
      (symbol) => !this.conflicted.has(symbol.normalizedName),
    );
  }

  originOf(name: string): string | undefined {
    return this.origins.get(normalizeSymbol(name));
  }

  /** Constants answered from outside this file since the last `forgetExternalUses`. */
  externalUses(): readonly ExternalUse[] {
    return [...this.used.values()];
  }

  forgetExternalUses(): void {
    this.used.clear();
  }

  private evaluateInternal(name: string, stack: Set<string>): ConstantResult {
    const normalizedName = normalizeSymbol(name);
    if (this.conflicted.has(normalizedName))
      return { known: false, reason: "unknown-symbol" };
    const symbol = this.constants.get(normalizedName);
    if (!symbol) {
      // Nothing in this file defines it, so fall back to the rest of the
      // project. The index only answers for names with one unambiguous value.
      const found = this.external?.lookup(normalizedName);
      if (found) {
        this.origins.set(normalizedName, found.origin);
        this.used.set(normalizedName, {
          name,
          value: found.value,
          origin: found.origin,
        });
        return { known: true, value: found.value };
      }
      return { known: false, reason: "unknown-symbol" };
    }

    if (stack.has(normalizedName)) {
      return { known: false, reason: "cyclic-symbol" };
    }

    const nextStack = new Set(stack);
    nextStack.add(normalizedName);

    return evaluateConstant(symbol.expression, (referencedName) => {
      const result = this.evaluateInternal(referencedName, nextStack);
      return result.known ? result.value : undefined;
    });
  }
}
