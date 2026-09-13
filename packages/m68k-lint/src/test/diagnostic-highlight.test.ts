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
