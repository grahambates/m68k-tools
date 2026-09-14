import { lintSource } from "../core/lint.js";
import { fixtureContext } from "./helpers.js";

test("optimization display includes operands but excludes trailing comments", () => {
  const ds = lintSource("\tmove.l #1,d0 ; comment", {
    processors: ["mc68000"],
  });
  const d = ds.find((d) => d.ruleId === "optimization/prefer-moveq")!;
  expect(d.highlight?.start.start).toBe(1);
  expect(d.highlight?.end.end).toBe(13);
});

test("an explicitly located operand stays precise", () => {
  const ctx = fixtureContext("move.l #1,d0");
  const loc = { line: 1, start: 8, end: 10 };
  ctx.report({
    ruleId: "test/operand",
    category: "optimization",
    severity: "suggestion",
    confidence: "certain",
    message: "operand",
    loc,
  });
  const [d] = ctx.getDiagnostics();
  expect(d.loc).toEqual(loc);
  expect(d.highlight).toBeUndefined();
});

test.each([
  [" move.l #2,d0", 8, 10],
  [" add.l #1,d0", 1, 5],
  [" move.w #2,d0", 1, 13],
  ["", 1, 13],
  [" moveq #1,d0\n not.b d0", 1, 13],
])("highlights the affected tokens for %s", (replacement, start, end) => {
  const ctx = fixtureContext("\tmove.l #1,d0 ; comment");
  ctx.report({
    ruleId: "test/replacement",
    category: "optimization",
    severity: "suggestion",
    confidence: "certain",
    message: "rewrite",
    loc: ctx.file.lines[0].mnemonic!.loc,
    suggestion: { description: "rewrite", replacement, applicability: "safe" },
  });
  const [d] = ctx.getDiagnostics();
  expect(d.highlight?.start.start).toBe(start);
  expect(d.highlight?.end.end).toBe(end);
  expect(d.span).toEqual({ startLine: 1, endLine: 1 });
});
