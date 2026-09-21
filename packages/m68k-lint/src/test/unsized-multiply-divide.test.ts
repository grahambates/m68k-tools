import { defaultRules } from "../rules/index.js";
import { lint } from "./helpers.js";

/**
 * On the 68000 MULU, MULS, DIVU and DIVS only have a word form, so `divu #10,d0`
 * and `divu.w #10,d0` are the same instruction and much real code uses the
 * bare one. A rule that insisted on the `.w` never fired on it.
 */
const RULES = [
  "optimization/multiply-word-by-zero",
  "optimization/muls-word-by-one",
  "optimization/mulu-word-by-one",
  "optimization/muls-word-power-of-two",
  "optimization/mulu-word-power-of-two",
  "optimization/muls-word-high-power-of-two",
  "optimization/mulu-word-high-power-of-two",
  "optimization/muls-word-selected-constants",
  "optimization/muls-word-full-result-constants",
  "optimization/muls-word-low-word-only",
  "optimization/mulu-word-low-word-only",
  "optimization/negative-signed-multiply",
  "optimization/divu-word-power-of-two",
  "optimization/divu-word-by-constant",
  "optimization/divs-word-power-of-two",
  "optimization/divs-word-by-constant",
];

const bare = (source: string) =>
  source.replace(/\b(mulu|muls|divu|divs)\.w\b/g, "$1");

describe.each(RULES)("%s", (id) => {
  const rule = defaultRules.find((r) => r.meta.id === id);
  const example = rule?.meta.docs?.example?.source ?? "";
  const fires = (source: string) => lint(source).some((d) => d.ruleId === id);

  test("has a documented example that names the word form", () => {
    expect(example).toMatch(/\b(mulu|muls|divu|divs)\.w\b/);
    expect(fires(example)).toBe(true);
  });

  test("fires on the same code written without the .w", () => {
    expect(fires(bare(example))).toBe(true);
  });
});

test("an explicit .l is still not the word form", () => {
  const ids = (source: string) =>
    lint(source, { processors: ["mc68020"] }).map((d) => d.ruleId);
  expect(ids("divu.l #10,d0\nmove.w d0,d2\nmoveq #0,d0\nrts")).not.toContain(
    "optimization/divu-word-by-constant",
  );
});
