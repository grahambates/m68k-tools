import parse from "../../src/parse";
import { calculateTotals, formatTotalsTiming } from "../../src/totals";
import { CacheModels, type Cpu } from "../../src/syntax";
import { PlainTextFormatter, JsonFormatter } from "../../src/formatters";

// Explicit examples from MC68040UM §10.4–6 and MC68060UM §10.4–14.
// 040 clock values are execute-lead + execute-base; never add EA calculate.
test.each([
  ["68040", "btst #3,d0", [1, 0, 0]],
  ["68040", "btst d1,d0", [2, 0, 0]],
  ["68040", "bset #3,(a0)", [3, 1, 1]],
  ["68040", "bclr d1,4(a0)", [4, 1, 1]],
  ["68040", "bchg #3,4(a0)", [4, 1, 1]],
  ["68040", "btst #3,4(pc)", [3, 1, 0]],
  ["68040", "btst d1,4(pc,d0)", [6, 1, 0]],
  ["68040", "bset d1,300(a0,d0)", [11, 1, 1]],
  ["68040", "btst #3,([4,a0],d0,8)", [12, 2, 0]],
  ["68040", "movem.w (a0)+,d0-d2", [6, 3, 0]],
  ["68040", "movem.w (a0),a1-a2", [8, 2, 0]],
  ["68040", "movem.w 4(a0),d0-d1/a1-a2", [9, 4, 0]],
  ["68040", "asl.w (a0)", [3, 1, 1]],
  ["68040", "asr.w (a0)+", [2, 1, 1]],
  ["68040", "lsl.w -(a0)", [2, 1, 1]],
  ["68040", "lsr.w 4(a0,d0)", [4, 1, 1]],
  ["68040", "asl.w 300(a0,d0)", [10, 1, 1]],
  ["68040", "rol.w 300(a0,d0)", [9, 1, 1]],
  ["68040", "ror.w ([4,a0,d0],8)", [12, 2, 1]],
  ["68040", "roxl.w ([4,a0],d0,8)", [12, 2, 1]],
  ["68040", "roxr.w ([4,a0,d0])", [10, 2, 1]],
  ["68040", "moveq #1,d0", [1, 0, 0]],
  ["68060", "moveq #1,d0", [1, 0, 0]],
  ["68040", "move.l (a0),d0", [1, 1, 0]],
  ["68060", "move.l (a0),d0", [1, 1, 0]],
  ["68040", "move.l (a0),(a1)", [1, 1, 1]],
  ["68060", "move.l (a0),(a1)", [2, 1, 1]],
  ["68040", "move.l (a0),4(a1)", [2, 1, 1]],
  ["68060", "move.l #1,4(a1)", [2, 0, 1]],
  ["68040", "move.l 4(a0,d0),d1", [3, 1, 0]],
  ["68060", "move.l 4(a0,d0),d1", [1, 1, 0]],
  ["68040", "move.l 256(a0,d0),d1", [7, 1, 0]],
  ["68060", "move.l 256(a0,d0),d1", [2, 1, 0]],
  ["68040", "move.l ([4,a0,d0],8),d1", [11, 2, 0]],
  ["68060", "move.l ([4,a0,d0],8),d1", [4, 2, 0]],
  ["68040", "move.l ([4,a0],d0,8),d1", [12, 2, 0]],
  ["68060", "move.l ([4,a0],d0,8),d1", [4, 2, 0]],
  ["68040", "move.l d1,([4,a0],d0,8)", [12, 1, 1]],
  ["68060", "move.l d1,([4,a0],d0,8)", [4, 1, 1]],
  ["68040", "add.l d0,d1", [1, 0, 0]],
  ["68060", "add.l d0,d1", [1, 0, 0]],
  ["68040", "add.l d0,(a0)", [1, 1, 1]],
  ["68060", "add.l d0,(a0)", [1, 1, 1]],
  ["68040", "addi.l #1,4(a0)", [2, 1, 1]],
  ["68060", "addi.l #1,4(a0)", [2, 1, 1]],
  ["68040", "clr.l (a0)", [1, 0, 1]],
  ["68060", "clr.l (a0)", [1, 0, 1]],
  ["68040", "lea 4(pc),a0", [4, 0, 0]],
  ["68060", "lea 4(pc),a0", [1, 0, 0]],
  ["68040", "pea (a0)", [2, 0, 1]],
  ["68060", "pea (a0)", [1, 0, 1]],
  ["68040", "mulu.w d0,d1", [14, 0, 0]],
  ["68060", "mulu.w d0,d1", [2, 0, 0]],
  ["68040", "muls.l d0,d1", [20, 0, 0]],
  ["68060", "muls.l d0,d1", [2, 0, 0]],
  ["68040", "divu.w d0,d1", [27, 0, 0]],
  ["68060", "divu.w d0,d1", [22, 0, 0]],
  ["68040", "lsl.w #2,d0", [2, 0, 0]],
  ["68060", "lsl.w #2,d0", [1, 0, 0]],
  ["68040", "asl.w d1,d0", [4, 0, 0]],
  ["68060", "asl.w d1,d0", [1, 0, 0]],
  ["68040", "rts", [5, 1, 0]],
  ["68060", "rts", [7, 1, 0]],
  ["68040", "nop", [8, 0, 0]],
  ["68060", "nop", [9, 0, 0]],
  ["68040", "movem.l d0-d2,-(a0)", [5, 0, 3]],
  ["68040", "movem.l (a0)+,d0-d2", [6, 3, 0]],
  ["68060", "movem.l d0-d2,-(a0)", [3, 0, 3]],
  ["68060", "movem.l (a0)+,d0-d2", [3, 3, 0]],
] as [Cpu, string, number[]][])("%s cached %s", (cpu, source, expected) => {
  for (const cacheModel of [undefined, CacheModels.Cache, CacheModels.Worst]) {
    const timing = parse(" " + source, { cpu, cacheModel })[0].timing;
    expect(timing?.values).toEqual([expected]);
    expect(timing?.reference).toMatchObject({
      cpu,
      cache: "instruction-and-data",
      accesses: "operand",
    });
  }
});

test("040 stage data preserves the manual's lead/base distinction", () => {
  expect(
    parse(" lea 4(pc),a0", { cpu: "68040" })[0].timing?.reference?.stages,
  ).toEqual({ calculate: 4, executeLead: 3, executeBase: 1 });
});

test("060 branch predictions remain distinct outcomes", () => {
  const timing = parse(" bne target", { cpu: "68060" })[0].timing!;
  expect(timing.values.map((v) => v[0])).toEqual([7, 1, 3, 7, 0, 1, 7]);
  expect(timing.labels).toHaveLength(7);
  expect(timing.labels.at(-1)).toBe("Mispredicted");
});

test.each(["68040", "68060"] as Cpu[])(
  "%s unsupported forms never inherit another CPU's costs",
  (cpu) => {
    for (const source of [
      "fadd fp0,fp1",
      "cas2 d0:d1,d2:d3,(a0):(a1)",
      "divu.l d0,d1:d2",
      "move.l unknown(a0,d0),d1",
      "move.l d0,([4,pc],d1)",
    ]) {
      const line = parse(" " + source, { cpu })[0];
      expect(line.timing).toBeUndefined();
      expect(line.timingUnavailable).toContain("no cached timing");
    }
  },
);

test("source CPU directives override defaults without changing older cache modes", () => {
  const lines = parse(
    " machine mc68040\n moveq #1,d0\n mc68060\n moveq #1,d0\n machine mc68020\n moveq #1,d0",
    { cpu: "68000" },
  );
  expect(lines[1].timing?.reference?.cpu).toBe("68040");
  expect(lines[3].timing?.reference?.cpu).toBe("68060");
  expect(lines[5].timing?.reference).toBeUndefined();
  expect(lines[5].timing?.values[0]).toHaveLength(4);
  const totals = calculateTotals(lines);
  expect(totals.timingGroups).toHaveLength(3);
  expect(formatTotalsTiming(totals)).toContain(
    "68040 cached execution-stage reference",
  );
  expect(formatTotalsTiming(totals)).toContain(
    "Bus clocks(reads/prefetches/writes)",
  );
});

test("macro and rept aggregates preserve their timing basis", () => {
  const lines = parse(
    "foo macro\n moveq #1,d0\n endm\n foo\n rept 2\n moveq #1,d0\n endr",
    { cpu: "68060" },
  );
  const totals = calculateTotals(lines);
  expect(totals.timingGroups).toEqual([
    {
      model: "68060 cached instruction-execution reference",
      min: [3, 0, 0],
      max: [3, 0, 0],
    },
  ]);
});

test("CLI formatters expose assumptions and incomplete coverage", () => {
  const lines = parse(" moveq #1,d0\n movep.l d0,4(a0)", { cpu: "68060" });
  const totals = calculateTotals(lines);
  const include = { text: true, timings: true, bytes: true, totals: true };
  const text = new PlainTextFormatter({
    color: false,
    width: 20,
    include,
  }).format(lines, totals);
  expect(text).toContain("operand accesses, not external bus transfers");
  expect(text).toContain("excluded from timing totals");
  const json = JSON.parse(
    new JsonFormatter({ prettyPrint: false, include }).format(lines, totals),
  );
  expect(json.lines[0].timing.reference.cpu).toBe("68060");
  expect(json.lines[1].timingUnavailable).toContain("no cached timing");
});

test("zero-cost branch outcomes survive macro aggregation", () => {
  const lines = parse("foo macro\n bra target\n endm\n foo", { cpu: "68060" });
  expect(calculateTotals(lines).timingGroups?.[0]).toMatchObject({
    min: [0, 0, 0],
    max: [3, 0, 0],
  });
});

test("missing coverage propagates out of macros", () => {
  const lines = parse(
    "foo macro\n movep.l d0,4(a0)\n moveq #1,d0\n endm\n foo",
    { cpu: "68060" },
  );
  expect(calculateTotals(lines).incomplete).toBe(true);
  expect(lines.at(-1)?.timingUnavailable).toContain("incomplete");
});

test.each(["68040", "68060"] as Cpu[])(
  "%s does not give a normal division cost for an explicit zero divisor",
  (cpu) => {
    expect(parse(" divu.w #0,d0", { cpu })[0].timing).toBeUndefined();
  },
);

test.each(["asl.b (a0)", "lsr.l (a0)", "rol.w 4(pc)"])(
  "040 does not time invalid memory shift %s",
  (source) => {
    expect(parse(" " + source, { cpu: "68040" })[0].timing).toBeUndefined();
  },
);

test.each(["bset #1,4(pc)", "btst.w #1,d0", "bclr.l #1,(a0)", "btst #1,a0"])(
  "040 leaves invalid bit operation untimed: %s",
  (source) => {
    expect(parse(" " + source, { cpu: "68040" })[0].timing).toBeUndefined();
  },
);

test("040 word MOVEM preserves separate calculate and execute adjustments", () => {
  expect(
    parse(" movem.w (a0),d0-d2", { cpu: "68040" })[0].timing?.reference?.stages,
  ).toEqual({ calculate: 4, executeLead: 1, executeBase: 5 });
});

test.each(["68030", "68040", "68060"] as Cpu[])(
  "%s respects explicit full-format displacement widths",
  (cpu) => {
    for (const [forced, inferred] of [
      ["4.w(a0,d0)", "300(a0,d0)"],
      ["4.l(a0,d0)", "70000(a0,d0)"],
      ["([0.w,a0,d0],4.l)", "([16,a0,d0],70000)"],
    ]) {
      expect(parse(` move.l ${forced},d1`, { cpu })[0].timing?.values).toEqual(
        parse(` move.l ${inferred},d1`, { cpu })[0].timing!.values,
      );
    }
  },
);

test.each(["68020", "68030", "68060"] as Cpu[])(
  "%s exposes an additive EA calculation for both cache selections",
  (cpu) => {
    for (const cacheModel of [CacheModels.Cache, CacheModels.Worst]) {
      const timing = parse(" neg.l 300(a0,d0)", { cpu, cacheModel })[0].timing!;
      const calculation = timing.calculation!;
      const base = (calculation.selectedBase ?? calculation.base)[0];
      expect(calculation.ea).toBeDefined();
      expect(base.map((n, i) => n + calculation.ea![i])).toEqual(
        timing.values[0],
      );
    }
  },
);
