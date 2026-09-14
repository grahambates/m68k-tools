import parse from "../../src/parse";
import { CacheModels, Cpus, toCpu } from "../../src/syntax";
import { calculateTotals } from "../../src/totals";

const cpu = Cpus.MC68030;
// Independent examples from Motorola MC68030UM §11.6. EA terms are added
// without head/tail overlap, in keeping with the counter's isolated model.
test.each([
  ["moveq #1,d0", [2, 0, 0, 0], [2, 0, 1, 0]],
  ["move.l d0,d1", [2, 0, 0, 0], [2, 0, 1, 0]],
  ["move.l d0,(a0)", [3, 0, 0, 1], [4, 0, 1, 1]],
  ["move.l (a0),d0", [5, 1, 0, 0], [5, 1, 1, 0]],
  ["move.l #256,d0", [6, 0, 0, 0], [6, 0, 2, 0]],
  ["move.w #256,d0", [4, 0, 0, 0], [4, 0, 2, 0]],
  ["move.l 4(a0),(a1)", [8, 1, 0, 1], [9, 1, 2, 1]],
  ["move.l d0,4(a0)", [4, 0, 0, 1], [5, 0, 1, 1]],
  ["move.l d0,4(a0,d1.w)", [6, 0, 0, 1], [7, 0, 1, 1]],
  ["add.l d0,d1", [2, 0, 0, 0], [2, 0, 1, 0]],
  ["adda.w d0,a0", [4, 0, 0, 0], [4, 0, 1, 0]],
  ["adda.l d0,a0", [2, 0, 0, 0], [2, 0, 1, 0]],
  ["add.w d0,(a0)", [6, 1, 0, 1], [7, 1, 1, 1]],
  ["addi.w #5,(a0)", [6, 1, 0, 1], [8, 1, 2, 1]],
  ["addi.l #5,(a0)", [7, 1, 0, 1], [9, 1, 2, 1]],
  ["cmpi.w #5,(a0)", [5, 1, 0, 0], [6, 1, 2, 0]],
  ["mulu.w d0,d1", [28, 0, 0, 0], [28, 0, 1, 0]],
  ["divu.w d0,d1", [44, 0, 0, 0], [44, 0, 1, 0]],
  ["muls.l d0,d1", [46, 0, 0, 0], [46, 0, 2, 0]],
  ["clr.w 4(a0)", [5, 0, 0, 1], [6, 0, 2, 1]],
  ["lsl.w #2,d0", [4, 0, 0, 0], [4, 0, 1, 0]],
  ["asl.w #2,d0", [6, 0, 0, 0], [6, 0, 1, 0]],
  ["addx.w -(a0),-(a1)", [9, 2, 0, 1], [10, 2, 1, 1]],
  ["bset d0,d1", [6, 0, 0, 0], [6, 0, 1, 0]],
  ["bftst d0{0:8}", [8, 0, 0, 0], [8, 0, 1, 0]],
  ["movem.l d0-d2,-(sp)", [12, 0, 0, 3], [12, 0, 2, 3]],
  ["movem.l (sp)+,d0-d2", [24, 3, 0, 0], [24, 3, 2, 0]],
  ["movep.l d0,0(a0)", [14, 0, 0, 4], [14, 0, 1, 4]],
  ["movec d0,cacr", [12, 0, 0, 0], [12, 0, 1, 0]],
  ["movec d0,vbr", [6, 0, 0, 0], [6, 0, 1, 0]],
  ["bsr.w target", [6, 0, 0, 1], [9, 0, 2, 1]],
  ["jsr (a0)", [4, 0, 0, 1], [7, 0, 2, 1]],
  ["lea 4(a0),a1", [4, 0, 0, 0], [4, 0, 2, 0]],
  ["rts", [9, 1, 0, 0], [11, 1, 2, 0]],
  ["nop", [2, 0, 0, 0], [2, 0, 1, 0]],
] as [string, number[], number[]][])("68030 %s", (source, cached, uncached) => {
  expect(parse(" " + source, { cpu })[0].timing?.values).toEqual([uncached]);
  expect(
    parse(" " + source, { cpu, cacheModel: CacheModels.Cache })[0].timing
      ?.values,
  ).toEqual([cached]);
});

test("branches and variable shifts retain their outcomes", () => {
  expect(parse(" bne.w target", { cpu })[0].timing?.values).toEqual([
    [8, 0, 2, 0],
    [6, 0, 1, 0],
  ]);
  expect(parse(" dbra d0,target", { cpu })[0].timing?.values).toEqual([
    [8, 0, 2, 0],
    [8, 0, 1, 0],
    [13, 0, 3, 0],
  ]);
  expect(parse(" lsr.w d1,d0", { cpu })[0].timing?.values).toEqual([
    [6, 0, 1, 0],
    [8, 0, 1, 0],
  ]);
});

test("machine directives and options select 68030 without using 68020 timings", () => {
  expect(toCpu("mc68030")).toBe(cpu);
  expect(parse(" machine mc68030\n moveq #1,d0")[1].timing?.values).toEqual([
    [2, 0, 1, 0],
  ]);
  expect(parse(" mc68030\n moveq #1,d0")[1].timing?.values).toEqual([
    [2, 0, 1, 0],
  ]);
  expect(
    parse(" machine mc68000\n moveq #1,d0", { cpu })[1].timing?.values,
  ).toEqual([[4, 1, 0]]);
  expect(calculateTotals(parse(" moveq #1,d0\n rts", { cpu })).min).toEqual([
    13, 1, 3, 0,
  ]);
});

test.each([
  "move.l unknown(a0,d0),d1",
  "move.l ([unknown,a0],d0,8),d1",
  "move.l 4.w(a0,d0),d1",
  "move.l 4(za0,d0),d1",
  "bftst (a0){d0:d1}",
  "pflush #0,#0",
])("does not invent timings for unsupported forms: %s", (source) => {
  expect(parse(" " + source, { cpu })[0].timing).toBeUndefined();
});
