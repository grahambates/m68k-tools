import { parseFile } from "m68k-parser";
import { applyOnce } from "../core/fix.js";
import { fixture, lint } from "./helpers.js";

// Exercise emitted fixes, not just the metadata: the original source is the
// useful documentation when these rewrites erase a value or change its meaning.
test.each([
  ["normalize-byte-rotate-direction", "COUNT equ 7\nrol.b #COUNT,d0"],
  ["prefer-bset", "MASK equ 8\nor.l #MASK,d0"],
  ["combine-adjacent-move-bytes", "move.b #$12,(a0)\nmove.b #$34,1(a0)"],
  [
    "address-arithmetic-indexed-lea",
    "OFFSET equ 12\nadda.w #OFFSET,a0\nadda.w d0,a0",
  ],
  ["zero-address-register", "NULL equ 0\nmovea.l #NULL,a0"],
  ["shift-to-clear", "COUNT equ 8\nlsl.b #COUNT,d0"],
  ["prefer-not", "MASK equ -1\neor.l #MASK,d0"],
  ["prefer-tst-zero", "EMPTY equ 0\ncmp.l #EMPTY,d0"],
  ["jsr-jmp-tail-dispatch", "jsr subroutine\njmp continuation"],
  ["combine-consecutive-shift", "lsl.w #8,d0\nlsl.w #4,d0\nmoveq #0,d1\nrts"],
])("preserves intent for %s", (name, source) => {
  const diagnostic = lint(source).find(
    (d) => d.ruleId === `optimization/${name}`,
  );
  expect(diagnostic?.suggestion?.replacement).toBeDefined();
  const original = fixture(source);
  const result = applyOnce(
    original,
    [diagnostic!],
    ["safe", "conditional"],
    undefined,
    ["improvement", "tradeoff", "neutral", "regression"],
  );
  expect(result.applied).toHaveLength(1);
  const lines = original.split("\n");
  const { startLine, endLine } = diagnostic!.span!;
  for (const line of lines.slice(startLine - 1, endLine))
    expect(result.output).toContain(`; ${line.trim()}`);
  expect(parseFile(result.output).errors).toHaveLength(0);
  expect(
    applyOnce(original, [diagnostic!], ["safe", "conditional"], "none", [
      "improvement",
      "tradeoff",
      "neutral",
      "regression",
    ]).output,
  ).not.toContain("; was:");
});

test.each([
  ["prefer-moveq", "COUNT equ 42\nmove.l #COUNT,d0"],
  ["prefer-addq", "STEP equ 4\nadd.l #STEP,d0"],
  ["address-add-to-lea", "OFFSET equ 100\nadda.l #OFFSET,a0"],
  ["null-branch", "bra next\nnext:\nrts"],
  ["known-zero-clear", "moveq #0,d0\nclr.w (a0)"],
  ["bset-low-word-mask", "BIT equ 8\nbset.l #BIT,d0\nmoveq #0,d7"],
  ["bclr-low-word-mask", "BIT equ 8\nbclr.l #BIT,d0\nmoveq #0,d7"],
  ["bchg-low-word-mask", "BIT equ 8\nbchg.l #BIT,d0\nmoveq #0,d7"],
  [
    "arithmetic-immediate-via-scratch",
    "VALUE equ 20\nadd.l #VALUE,d1\nmoveq #0,d0\nmove.l d1,d2",
  ],
  [
    "compare-long-immediate-via-moveq",
    "VALUE equ 42\ncmp.l #VALUE,d0\nmoveq #0,d7",
  ],
  [
    "move-immediate-via-scratch",
    "VALUE equ 42\nmove.l #VALUE,(a0)\nmoveq #0,d7",
  ],
  [
    "mask-via-moveq",
    "MASK equ $3f\nmove.l (a0),d0\nand.l #MASK,d0\nmoveq #0,d7",
  ],
  ["push-immediate-pea", "VALUE equ 42\nmove.l #VALUE,-(sp)"],
  [
    "destructive-small-compare-branch",
    "VALUE equ 3\ncmp.w #VALUE,d0\nbne alt\nmoveq #0,d0\naddq.l #1,d1\nbra done\nalt:\nmoveq #0,d0\naddq.l #1,d1\ndone:\nnop",
  ],
])("keeps straightforward %s fixes plain", (name, source) => {
  const diagnostic = lint(source).find(
    (d) => d.ruleId === `optimization/${name}`,
  );
  expect(diagnostic?.suggestion?.replacement).toBeDefined();
  const result = applyOnce(
    fixture(source),
    [diagnostic!],
    ["safe", "conditional"],
    undefined,
    ["improvement", "tradeoff", "neutral", "regression"],
  );
  expect(result.applied).toHaveLength(1);
  expect(result.output).not.toContain("; was:");
});
