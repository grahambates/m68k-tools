import {
  evaluateConstant,
  type ExpressionNode,
  type OperandNode,
} from "m68k-parser";
import type { Variables } from "../parse/evaluate";
import type { Timing2 } from "./tables68020";

export type EaKind =
  "fetch" | "fetchImm" | "fetchImmL" | "calc" | "calcImm" | "jump" | "move";
export type FullForm =
  | "word"
  | "long"
  | "indirectWord0"
  | "indirectPostWord16"
  | "indirectPostWord32"
  | "indirectWord16"
  | "indirectWord32"
  | "indirect0_0"
  | "indirect0_16"
  | "indirect0_32"
  | "indirect16_0"
  | "indirect16_16"
  | "indirect16_32"
  | "indirect32_0"
  | "indirect32_16"
  | "indirect32_32";

/** null means the encoding cannot be determined; undefined is an ordinary EA. */
export function fullFormat(
  node: OperandNode,
  vars: Variables,
): FullForm | null | undefined {
  const value = (expression?: ExpressionNode): number | undefined => {
    if (!expression) return 0;
    const result = evaluateConstant(expression, (name) =>
      Object.hasOwn(vars, name) ? vars[name] : undefined,
    );
    return result.known &&
      Number.isInteger(result.value) &&
      result.value >= -2147483648 &&
      result.value <= 2147483647
      ? result.value
      : undefined;
  };
  if (
    "indexRegister" in node &&
    node.indexRegister &&
    node.indexRegister.type !== "data-register" &&
    node.indexRegister.type !== "address-register"
  )
    return null;
  if (
    node.type === "address-register-indirect-index" &&
    node.baseRegister.type !== "address-register"
  )
    return null;
  if (node.type === "memory-indirect") {
    const bd = value(node.baseDisplacement),
      od = value(node.outerDisplacement);
    if (bd === undefined || od === undefined) return null;
    const base =
      node.baseDisplacementSize === "w"
        ? 16
        : node.baseDisplacementSize === "l"
          ? 32
          : bd === 0
            ? 0
            : bd >= -32768 && bd <= 32767
              ? 16
              : 32;
    const outer =
      node.outerDisplacementSize === "w"
        ? 16
        : node.outerDisplacementSize === "l"
          ? 32
          : od === 0
            ? 0
            : od >= -32768 && od <= 32767
              ? 16
              : 32;
    // The manual has faster d16,An/PC rows when the index is not added
    // before the pointer fetch. Preindexed forms use its general B rows.
    const plainBase =
      node.baseRegister &&
      (node.baseRegister.type === "address-register" ||
        (node.baseRegister.type === "symbol" &&
          node.baseRegister.name.toLowerCase() === "pc"));
    if (
      base === 16 &&
      plainBase &&
      (!node.indexRegister || node.indexPosition === "post")
    ) {
      if (node.indexRegister && outer !== 0)
        return `indirectPostWord${outer}` as FullForm;
      return `indirectWord${outer}` as FullForm;
    }
    return `indirect${base}_${outer}` as FullForm;
  }
  if (
    node.type === "address-register-indirect-index" ||
    node.type === "pc-relative-index"
  ) {
    const displacement = value(node.displacement);
    if (displacement === undefined) return null;
    if (node.displacementSize === "w") return "word";
    if (node.displacementSize === "l") return "long";
    if (displacement >= -128 && displacement <= 127) return undefined;
    return displacement >= -32768 && displacement <= 32767 ? "word" : "long";
  }
  if (
    node.type === "address-register-indirect-displacement" ||
    node.type === "pc-relative"
  ) {
    const displacement = value(node.displacement);
    if (node.displacementSize === "l") return "long";
    // Unknown ordinary displacements retain the existing d16 estimate.
    if (
      displacement !== undefined &&
      (displacement < -32768 || displacement > 32767)
    )
      return "long";
  }
  return undefined;
}

// MC68030UM §11.6.1–6 (pp. 11-27–38), full extension-word rows.
// Each entry is [cached clocks, uncached clocks, uncached prefetches].
// Pointer reads are added separately; calculate/jump/MOVE do not fetch data.
// The general B rows cover preindexing and suppressed base/index registers.
// Displacements use the smallest encoding that represents a known value.
// Obvious misprints in the general B rows are normalised: calculate-EA
// reads only the pointer (one read), and the duplicated final d16 base labels
// mean d32. Fetch-immediate ([d16,B]) has two prefetches, like its indexed
// counterpart, rather than the printed zero. Other numeric differences are
// retained, including the special postindexed exceptions below.
type Cost = [number, number, number];
type Row = Record<EaKind, Cost>;
const rows: Record<
  Exclude<FullForm, "indirectPostWord16" | "indirectPostWord32">,
  Row
> = {
  word: {
    fetch: [6, 7, 1],
    fetchImm: [8, 9, 2],
    fetchImmL: [10, 11, 2],
    calc: [6, 6, 1],
    calcImm: [8, 8, 2],
    jump: [6, 6, 0],
    move: [8, 9, 2],
  },
  long: {
    fetch: [12, 13, 2],
    fetchImm: [14, 16, 2],
    fetchImmL: [16, 18, 3],
    calc: [12, 12, 2],
    calcImm: [14, 15, 2],
    jump: [12, 13, 1],
    move: [14, 16, 2],
  },
  indirectWord0: {
    fetch: [10, 10, 1],
    fetchImm: [12, 12, 2],
    fetchImmL: [14, 14, 2],
    calc: [10, 10, 1],
    calcImm: [12, 12, 2],
    jump: [10, 10, 1],
    move: [10, 11, 2],
  },
  indirectWord16: {
    fetch: [12, 13, 2],
    fetchImm: [14, 15, 2],
    fetchImmL: [16, 17, 3],
    calc: [12, 13, 2],
    calcImm: [14, 15, 2],
    jump: [12, 12, 1],
    move: [12, 14, 2],
  },
  indirectWord32: {
    fetch: [12, 14, 2],
    fetchImm: [14, 16, 3],
    fetchImmL: [16, 18, 3],
    calc: [12, 13, 2],
    calcImm: [14, 16, 3],
    jump: [12, 12, 1],
    move: [14, 16, 3],
  },
  indirect0_0: {
    fetch: [10, 10, 1],
    fetchImm: [12, 12, 1],
    fetchImmL: [14, 14, 2],
    calc: [10, 10, 1],
    calcImm: [12, 12, 1],
    jump: [10, 10, 1],
    move: [10, 11, 1],
  },
  indirect0_16: {
    fetch: [12, 13, 1],
    fetchImm: [14, 15, 2],
    fetchImmL: [16, 17, 2],
    calc: [12, 13, 1],
    calcImm: [14, 15, 2],
    jump: [12, 12, 1],
    move: [12, 14, 2],
  },
  indirect0_32: {
    fetch: [12, 14, 2],
    fetchImm: [14, 16, 2],
    fetchImmL: [16, 18, 3],
    calc: [12, 13, 2],
    calcImm: [14, 15, 2],
    jump: [12, 12, 1],
    move: [14, 16, 2],
  },
  indirect16_0: {
    fetch: [12, 13, 1],
    fetchImm: [14, 15, 2],
    fetchImmL: [16, 17, 2],
    calc: [12, 13, 1],
    calcImm: [14, 15, 2],
    jump: [12, 13, 1],
    move: [12, 14, 2],
  },
  indirect16_16: {
    fetch: [14, 16, 2],
    fetchImm: [16, 18, 2],
    fetchImmL: [18, 20, 3],
    calc: [14, 16, 2],
    calcImm: [16, 18, 2],
    jump: [14, 15, 1],
    move: [14, 17, 2],
  },
  indirect16_32: {
    fetch: [14, 17, 2],
    fetchImm: [16, 19, 3],
    fetchImmL: [18, 21, 3],
    calc: [14, 16, 2],
    calcImm: [16, 18, 3],
    jump: [14, 15, 1],
    move: [16, 19, 3],
  },
  indirect32_0: {
    fetch: [16, 17, 2],
    fetchImm: [18, 19, 2],
    fetchImmL: [20, 21, 3],
    calc: [16, 17, 2],
    calcImm: [18, 19, 2],
    jump: [16, 17, 2],
    move: [16, 18, 2],
  },
  indirect32_16: {
    fetch: [18, 20, 2],
    fetchImm: [20, 22, 3],
    fetchImmL: [22, 24, 3],
    calc: [18, 20, 2],
    calcImm: [20, 22, 3],
    jump: [18, 19, 2],
    move: [18, 21, 3],
  },
  indirect32_32: {
    fetch: [18, 21, 3],
    fetchImm: [20, 23, 3],
    fetchImmL: [22, 25, 4],
    calc: [18, 20, 3],
    calcImm: [20, 22, 3],
    jump: [18, 19, 2],
    move: [20, 23, 3],
  },
};

export function fullEaTiming(form: FullForm, kind: EaKind): Timing2 {
  // These printed postindexed entries differ from their no-index neighbours.
  if (form === "indirectPostWord16" && kind === "fetchImm")
    return [
      [14, 2, 0, 0],
      [15, 2, 3, 0],
    ];
  if (form === "indirectPostWord32" && kind === "calcImm")
    return [
      [14, 1, 0, 0],
      [15, 1, 3, 0],
    ];
  const row =
    form === "indirectPostWord16"
      ? "indirectWord16"
      : form === "indirectPostWord32"
        ? "indirectWord32"
        : form;
  const [cached, uncached, prefetches] = rows[row][kind];
  const pointerReads = form.startsWith("indirect") ? 1 : 0;
  const reads = pointerReads + (kind.startsWith("fetch") ? 1 : 0);
  const writes = kind === "move" ? 1 : 0;
  return [
    [cached, reads, 0, writes],
    [uncached, reads, prefetches, writes],
  ];
}
