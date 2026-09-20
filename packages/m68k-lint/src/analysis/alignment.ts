import {
  directiveSize,
  type ExpressionNode,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";
import { analyzeLocalLabelScopes } from "./local-label-scopes.js";
import { expansionOf } from "../semantics/macro-expansions.js";
import { scanBlocks } from "./blocks.js";
import { conditionalAssembly } from "./conditionals.js";
import { hasEscapeSequences } from "./assembler-mode.js";

/** Whether an address is even (0) or odd (1); undefined when it cannot be told. */
export type Parity = 0 | 1 | undefined;

export interface AlignmentAnalysis {
  /** Parity of the address a line's contents start at, and where a label on it points. */
  parityBefore(index: number): Parity;
  /** The line whose odd number of bytes left the following address odd, if that is why it is. */
  oddSource(index: number): number | undefined;
  /** Parity of a label's address, as referenced from a line. */
  labelParity(name: string, fromIndex: number): Parity;
  /** The line a label is defined on. */
  labelLine(name: string, fromIndex: number): number | undefined;
}

/**
 * Directives that take no space, so leave the address as it was.
 *
 * Anything not here or handled explicitly makes the address unknown rather than
 * being assumed harmless: an INCLUDE or an unfamiliar directive may emit
 * bytes, and a wrong "odd" is worse than saying nothing.
 */
const NON_EMITTING = new Set([
  "equ",
  "=",
  "set",
  "fequ",
  "fset",
  "rs",
  "rsreset",
  "rsset",
  "xdef",
  "xref",
  "public",
  "global",
  "extern",
  "list",
  "nolist",
  "opt",
  "fail",
  "printt",
  "printv",
  "output",
  "machine",
  "cpu",
  "incdir",
  "comment",
  "macro",
  "endm",
  "mc68000",
  "mc68010",
  "mc68020",
  "mc68030",
  "mc68040",
  "mc68060",
]);

/** Directives that open or close code which may or may not be assembled. */
const CONDITIONAL_OR_REPEAT = /^(if|else|end[cif]|rept|endr|irp|irpc)/;

/**
 * Track whether each address is odd or even by counting the bytes that data
 * directives emit.
 *
 * Instructions and word or long data are always an even number of bytes, so
 * only byte-sized data, `ds.b`, `dcb.b` and alignment directives change the
 * parity. A section starts even. Everything the count cannot follow -- a
 * conditional or repeat block, INCLUDE or INCBIN, a macro call, an unknown
 * directive, an ORG to something unresolved -- makes it unknown until the next
 * `even` or `cnop` settles it again.
 */
export function analyzeAlignment(
  file: ParsedFile,
  evaluate: (expr: ExpressionNode) => number | undefined,
): AlignmentAnalysis {
  const blocks = scanBlocks(file);
  const assembly = conditionalAssembly(file);
  const scopes = analyzeLocalLabelScopes(file);
  const before: Parity[] = [];
  const source: (number | undefined)[] = [];
  const labels = new Map<string, number | null>();

  const sections = new Map<string, { parity: Parity; source?: number }>();
  let current = "";
  let parity: Parity = 0;
  let oddAt: number | undefined;

  const enter = (name: string) => {
    sections.set(current, { parity, source: oddAt });
    current = name;
    const known = sections.get(name);
    parity = known ? known.parity : 0;
    oddAt = known?.source;
  };
  const set = (next: Parity, at?: number) => {
    parity = next;
    oddAt = next === 1 ? at : undefined;
  };
  const advance = (bytes: number | undefined, at: number) => {
    if (bytes === undefined) set(undefined);
    else if (parity !== undefined && bytes % 2 === 1)
      set(parity === 0 ? 1 : 0, at);
  };

  file.lines.forEach((line: ParsedLine, index) => {
    // A macro body is assembled wherever it is invoked, not here.
    const inMacro = blocks.region[index] !== 0;
    before[index] = inMacro ? undefined : parity;
    source[index] = inMacro ? undefined : oddAt;
    if (inMacro) return;
    // Not assembled, so it takes no space and defines nothing.
    if (assembly.unassembled[index]) {
      before[index] = undefined;
      source[index] = undefined;
      return;
    }

    if (line.label) {
      const key = scopes.keyOf(index, line.label.label);
      labels.set(key, labels.has(key) ? null : index);
    }

    const mnemonic = line.mnemonic;
    if (!mnemonic) return;
    if (mnemonic.type === "instruction") return;
    // A macro that expands to instructions takes an even number of bytes.
    if (mnemonic.type === "macro")
      return expansionOf(line) ? undefined : set(undefined);
    if (mnemonic.type !== "directive") return;

    const directive = mnemonic.directive.toLowerCase();
    const size =
      line.qualifier?.type === "size" ? line.qualifier.size : undefined;
    const operands = line.operands ?? [];
    const count = (): number | undefined => {
      const first = operands[0];
      return first?.type === "value" ? evaluate(first.value) : undefined;
    };

    // A conditional whose outcome is known is not a choice: the arm taken
    // simply follows.
    if (assembly.decided[index] && /^(if|else|end[cif])/.test(directive))
      return;
    if (CONDITIONAL_OR_REPEAT.test(directive)) return set(undefined);
    if (NON_EMITTING.has(directive)) return;

    switch (directive) {
      case "section": {
        const name = operands[0];
        const text =
          name?.type === "value" && name.value.type === "symbol"
            ? name.value.name
            : name?.type === "string-literal"
              ? name.content
              : undefined;
        return enter(`section:${text?.toLowerCase() ?? index}`);
      }
      case "code":
      case "data":
      case "bss":
      case "text":
      case "cseg":
      case "dseg":
        return enter(`section:${directive}`);
      case "org": {
        const value = count();
        return set(value === undefined ? undefined : ((value & 1) as Parity));
      }
      case "even":
        return set(0);
      case "align": {
        const value = count();
        return value !== undefined && value >= 2 ? set(0) : set(undefined);
      }
      case "cnop": {
        const [offset, alignment] = operands.map((op) =>
          op.type === "value" ? evaluate(op.value) : undefined,
        );
        if (offset === undefined || alignment === undefined || alignment % 2)
          return set(undefined);
        return set((offset & 1) as Parity);
      }
      case "db":
      case "dw":
      case "dl":
      case "dc":
      case "ds":
      case "dcb":
      case "blk": {
        // Only byte-sized data changes the parity. Anything wider is an even
        // number of bytes whatever the count, so it is known without one.
        const width =
          directive === "db"
            ? "b"
            : directive === "dw"
              ? "w"
              : directive === "dl"
                ? "l"
                : (size ?? "w");
        if (width !== "b") return;
        return advance(
          directiveSize(line, {
            evaluate,
            escapeSequences: hasEscapeSequences(file),
          }),
          index,
        );
      }
      default:
        return set(undefined);
    }
  });

  return {
    parityBefore: (index) => before[index],
    oddSource: (index) => source[index],
    labelParity(name, fromIndex) {
      const at = labels.get(scopes.keyOf(fromIndex, name));
      return typeof at === "number" ? before[at] : undefined;
    },
    labelLine(name, fromIndex) {
      const at = labels.get(scopes.keyOf(fromIndex, name));
      return typeof at === "number" ? at : undefined;
    },
  };
}
