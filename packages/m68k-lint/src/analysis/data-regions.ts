import {
  directiveSize,
  isLocalLabelName,
  type ExpressionNode,
} from "m68k-parser";
import type { RuleContext } from "../core/context.js";
import { analyzeSections, type Section } from "./sections.js";
import { analyzeLocalLabelScopes } from "./local-label-scopes.js";
import { scanBlocks } from "./blocks.js";
import { conditionalAssembly } from "./conditionals.js";
import { hasEscapeSequences } from "./assembler-mode.js";

export interface DataRegion {
  bytes: number;
  section: Section;
  boundary?: { kind: "code" | "section"; index: number };
}
export interface DataAddress {
  region: DataRegion;
  offset: number;
  name: string;
  index: number;
}
interface State {
  region: DataRegion;
  parity?: number;
  absolute?: number;
  last: number;
}
const SECTION =
  /^(section|pushsection|popsection|code(?:_[cf])?|data(?:_[cf])?|bss(?:_[cf])?|text|cseg|dseg)$/;
const NON_EMITTING = new Set([
  "equ",
  "=",
  "set",
  "xdef",
  "xref",
  "public",
  "global",
  "extern",
  "list",
  "nolist",
]);

/**
 * Relative extents of data runs, independent of preceding instruction sizes.
 * Labels are offsets, never boundaries. Section streams survive reopenings.
 * Unknown output breaks a run; instructions prove a code boundary without
 * requiring an encoding size. End-of-file needs a known standalone source.
 */
export function analyzeDataRegions(ctx: RuleContext) {
  const sections = analyzeSections(ctx.file);
  const scopes = analyzeLocalLabelScopes(ctx.file);
  const labelKey = (from: number, name: string) =>
    isLocalLabelName(name) ? scopes.keyOf(from, name) : ctx.nameKey(name);
  const blocks = scanBlocks(ctx.file);
  const assembly = conditionalAssembly(ctx.file);
  const excluded = new Int32Array(ctx.file.lines.length + 1);
  for (const block of [
    ...blocks.repeats,
    ...blocks.conditionals.filter((b) => !assembly.decided[b.start]),
  ]) {
    excluded[block.start]++;
    excluded[block.end + 1]--;
  }
  for (let i = 1; i < excluded.length; i++) excluded[i] += excluded[i - 1];
  const states = new Map<string, State>();
  const labels = new Map<string, DataAddress | null>();
  let unknownSectionHistory = false;
  const evaluate = (expr: ExpressionNode) => {
    const result = ctx.evaluate(expr);
    return result.known ? result.value : undefined;
  };
  const reset = (state: State) => {
    state.region = { bytes: 0, section: state.region.section };
    state.absolute = undefined;
    state.parity = undefined;
  };
  const invalidateAll = () => {
    unknownSectionHistory = true;
    for (const state of states.values()) reset(state);
  };
  ctx.file.lines.forEach((line, index) => {
    if (blocks.region[index] || assembly.unassembled[index]) return;
    if (excluded[index] || line.inlineCondition !== undefined) {
      if (line.label) labels.set(labelKey(index, line.label.label), null);
      invalidateAll();
      return;
    }
    const directive =
      line.mnemonic?.type === "directive"
        ? line.mnemonic.directive.toLowerCase()
        : undefined;
    if (directive && (SECTION.test(directive) || assembly.decided[index]))
      return;
    const section = sections.at(index);
    if (!section) {
      invalidateAll();
      return;
    }
    let state = states.get(section.key);
    if (!state) {
      state = {
        region: { bytes: 0, section },
        parity: unknownSectionHistory ? undefined : 0,
        absolute: unknownSectionHistory ? undefined : 0,
        last: index,
      };
      states.set(section.key, state);
    }
    if (directive && NON_EMITTING.has(directive)) return;
    if (line.label) {
      const key = labelKey(index, line.label.label);
      labels.set(
        key,
        labels.has(key)
          ? null
          : {
              region: state.region,
              offset: state.region.bytes,
              name: line.label.label,
              index,
            },
      );
    }
    if (!line.mnemonic) return;
    state.last = index;
    if (line.mnemonic.type === "instruction") {
      state.region.boundary = { kind: "code", index };
      state.region = { bytes: 0, section };
      state.absolute = undefined; // Encodings can vary, but instruction sizes are even.
      return;
    }
    if (
      line.mnemonic.type === "macro" ||
      directive === "include" ||
      directive === "org" ||
      directive === "offset"
    ) {
      invalidateAll();
      return;
    }
    let bytes = directiveSize(line, {
      evaluate,
      escapeSequences: hasEscapeSequences(ctx.file),
    });
    if (directive === "even") bytes = state.parity;
    if (directive === "align" || directive === "cnop") {
      const values = (line.operands ?? []).map((op) =>
        op.type === "value" ? evaluate(op.value) : undefined,
      );
      const alignment = directive === "align" ? values[0] : values[1];
      const offset = directive === "align" ? 0 : values[0];
      const position = alignment === 2 ? state.parity : state.absolute;
      if (
        alignment !== undefined &&
        Number.isSafeInteger(alignment) &&
        alignment > 0 &&
        offset !== undefined &&
        Number.isSafeInteger(offset) &&
        offset >= 0 &&
        offset < alignment &&
        position !== undefined
      )
        bytes = (offset - (position % alignment) + alignment) % alignment;
    }
    if (
      bytes === undefined ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      state.region.bytes + bytes > 0xffffffff
    ) {
      reset(state);
      return;
    }
    state.region.bytes += bytes;
    if (state.absolute !== undefined) state.absolute += bytes;
    if (state.parity !== undefined) state.parity = (state.parity + bytes) % 2;
  });
  if (ctx.facts?.includedByProject === false) {
    for (const state of states.values())
      state.region.boundary = { kind: "section", index: state.last };
  }
  const resolve = (
    expr: ExpressionNode,
    from: number,
    depth = 0,
  ): DataAddress | undefined => {
    if (depth > 16) return;
    if (expr.type === "group") return resolve(expr.expression, from, depth + 1);
    if (expr.type === "symbol") {
      const key = labelKey(from, expr.name);
      if (labels.has(key)) return labels.get(key) ?? undefined;
      const constant = ctx.symbols.getConstant(expr.name);
      return constant
        ? resolve(constant.expression, constant.lineIndex, depth + 1)
        : undefined;
    }
    if (
      expr.type !== "binary-op" ||
      (expr.operator !== "+" && expr.operator !== "-")
    )
      return;
    const left = resolve(expr.left, from, depth + 1);
    const right = evaluate(expr.right);
    if (left && right !== undefined && Number.isSafeInteger(right))
      return {
        ...left,
        offset: left.offset + (expr.operator === "+" ? right : -right),
      };
    if (expr.operator === "+") {
      const address = resolve(expr.right, from, depth + 1);
      const offset = evaluate(expr.left);
      if (address && offset !== undefined && Number.isSafeInteger(offset))
        return { ...address, offset: address.offset + offset };
    }
  };
  return { resolve };
}
