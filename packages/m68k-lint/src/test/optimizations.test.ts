import { lintSource } from "../core/lint.js";
import { applyOnce } from "../core/fix.js";
import { consolidateOptimizations } from "../core/optimizations.js";
import { formatDiagnostic } from "../cli/format.js";
import { runInteractive } from "../core/interactive.js";
import type { Diagnostic } from "../core/diagnostic.js";

const lint = (source: string) =>
  lintSource(source, { processors: ["mc68000"] }).filter(
    (d) => d.category === "optimization",
  );
const source = "\tmove.l #168,d1\n\tadd.l d2,d3";

test("reports LEA directly instead of narrowing ADDA first", () => {
  const ds = lint("\tadda.l #100,a0");
  expect(ds.map((d) => d.ruleId)).toEqual(["optimization/address-add-to-lea"]);
  expect(applyOnce("\tadda.l #100,a0", ds, ["safe"]).output).toBe(
    "\tlea 100(a0),a0",
  );
});

test("groups the equal-cost NOT and ADD alternatives with one savings summary", () => {
  const ds = lint(source);
  const group = ds.find((d) => d.alternatives?.length)!;
  expect(group).toBeDefined();
  const choices = [group, ...group.alternatives!];
  expect(choices.map((d) => d.suggestion?.replacement)).toEqual(
    expect.arrayContaining([
      "\tmoveq #87,d1\n\tnot.b d1",
      "\tmoveq #84,d1\n\tadd.b d1,d1",
    ]),
  );
  const formatted = formatDiagnostic("example.s", source, group, false);
  expect(formatted).toContain("Alternative 2");
  expect(formatted.match(/saves:/g)).toHaveLength(1);
  expect(applyOnce(source, [group], ["safe"]).applied).toEqual([]);
});

test("interactive review can select the second alternative", async () => {
  const group = lint(source).find((d) => d.alternatives?.length)!;
  const result = await runInteractive(source, [group], () =>
    Promise.resolve({ alternative: 1 }),
  );
  expect(result.applied[0]?.ruleId).toBe(group.alternatives![0].ruleId);
});

function candidate(id: string, bytes: number, cycles: number): Diagnostic {
  return {
    ruleId: id,
    category: "optimization",
    severity: "suggestion",
    confidence: "certain",
    message: id,
    loc: { line: 1, start: 0, end: 3 },
    span: { startLine: 1, endLine: 1 },
    suggestion: {
      description: id,
      replacement: id,
      applicability: "safe",
      impact: {
        sizeBytes: {
          before: 6,
          after: bytes,
          delta: bytes - 6,
          confidence: "exact",
        },
        execution: {
          processor: "mc68000",
          cpuCycles: {
            before: 16,
            after: cycles,
            delta: cycles - 16,
            confidence: "exact",
          },
          readCycles: { before: 3, after: 2, delta: -1, confidence: "exact" },
          writeCycles: { before: 0, after: 0, delta: 0, confidence: "exact" },
        },
      },
    },
  };
}

test("keeps size/speed tradeoffs, unknown measurements, notes and mixed-target alternatives", () => {
  for (const kind of ["tradeoff", "unknown", "notes", "targets"]) {
    const a = candidate("a", 4, 8),
      b = candidate("b", kind === "tradeoff" ? 2 : 4, 12);
    if (kind === "unknown") delete a.suggestion!.impact!.execution!.readCycles;
    if (kind === "notes")
      b.notes = [{ message: "Assembler can relax this operand" }];
    const result = consolidateOptimizations([a, b], kind !== "targets");
    expect(result[0]?.alternatives).toHaveLength(1);
  }
});

test("does not combine conditional fixes or partially overlapping sequences", () => {
  const a = candidate("a", 4, 8),
    b = candidate("b", 4, 12);
  b.suggestion!.applicability = "conditional";
  expect(consolidateOptimizations([a, b], true)).toHaveLength(2);
  b.suggestion!.applicability = "safe";
  b.span!.endLine = 2;
  expect(consolidateOptimizations([a, b], true)).toHaveLength(2);
});

test("collapses exact duplicate replacements and honours disabled rules before choosing", () => {
  const a = candidate("a", 4, 8),
    b = candidate("b", 4, 8);
  b.suggestion!.replacement = a.suggestion!.replacement;
  expect(consolidateOptimizations([a, b], true)).toEqual([a]);
  const result = lintSource("\tadda.l #100,a0", {
    processors: ["mc68000"],
    rules: { "optimization/address-add-to-lea": "off" },
  });
  expect(
    result.some(
      (d) => d.ruleId === "optimization/narrow-address-immediate-word",
    ),
  ).toBe(true);
});

test("allowing a group suppresses every alternative on the next run", async () => {
  const group = lint(source).find((d) => d.alternatives?.length)!;
  const result = await runInteractive(source, [group], () =>
    Promise.resolve("allow"),
  );
  expect(lint(result.output).filter((d) => d.span?.startLine === 2)).toEqual(
    [],
  );
});

test("does not hide a replacement when the faster choice increases bus writes", () => {
  const a = candidate("a", 4, 8),
    b = candidate("b", 4, 12);
  a.suggestion!.impact!.execution!.writeCycles = {
    before: 0,
    after: 1,
    delta: 1,
    confidence: "exact",
  };
  expect(consolidateOptimizations([a, b], true)[0].alternatives).toHaveLength(
    1,
  );
});
