import parse from "../../src/parse";
import { Cpus, CacheModels } from "../../src/syntax";

// Operation + EA terms checked against MC68030UM §11.6.1–6.
// Explicit expected vectors also check that pointer reads are counted once.
test.each([
  ["move.l 256(a0,d0),d1", [8, 1, 0, 0], [9, 1, 2, 0]],
  ["move.l -129(a0,d0.w*4),d1", [8, 1, 0, 0], [9, 1, 2, 0]],
  ["move.l 65536(a0,d0),d1", [14, 1, 0, 0], [15, 1, 3, 0]],
  ["move.l 65536(a0),d1", [14, 1, 0, 0], [15, 1, 3, 0]],
  ["move.l 256(pc,d0),d1", [8, 1, 0, 0], [9, 1, 2, 0]],
  ["move.l ([a0]),d1", [12, 2, 0, 0], [12, 2, 2, 0]],
  ["move.l ([4,a0],d0),d1", [12, 2, 0, 0], [12, 2, 2, 0]],
  ["move.l ([4,a0],d0,8),d1", [14, 2, 0, 0], [15, 2, 3, 0]],
  ["move.l ([4,pc],d0,8),d1", [14, 2, 0, 0], [15, 2, 3, 0]],
  ["move.l ([4,a0,d0],8),d1", [16, 2, 0, 0], [18, 2, 3, 0]],
  ["move.l ([65536,a0],d0,65536),d1", [20, 2, 0, 0], [23, 2, 4, 0]],
  ["move.l ([4],d0,8),d1", [16, 2, 0, 0], [18, 2, 3, 0]],
  ["move.l d1,256(a0,d0)", [8, 0, 0, 1], [9, 0, 2, 1]],
  ["move.l d1,([4,a0],d0,8)", [12, 1, 0, 1], [14, 1, 2, 1]],
  ["move.l ([4,a0],d0,8),([4,a1,d2],8)", [26, 3, 0, 1], [30, 3, 4, 1]],
  ["addi.w #1,256(a0,d0)", [11, 1, 0, 1], [13, 1, 3, 1]],
  ["addi.l #1,256(a0,d0)", [13, 1, 0, 1], [15, 1, 3, 1]],
  ["cmpi.w #1,([4,a0],d0,8)", [16, 2, 0, 0], [17, 2, 4, 0]],
  ["cmpi.w #1,([a0],d0,8)", [16, 2, 0, 0], [17, 2, 3, 0]],
  ["cmpi.l #1,([a0],d0,8)", [18, 2, 0, 0], [19, 2, 3, 0]],
  ["clr.l ([4,a0],d0,8)", [15, 1, 0, 1], [17, 1, 3, 1]],
  ["lea ([4,a0,d0],8),a1", [16, 1, 0, 0], [18, 1, 3, 0]],
  ["jmp ([4,a0],d0,8)", [16, 1, 0, 0], [18, 1, 3, 0]],
  ["jsr ([65536,a0],d0,8)", [22, 1, 0, 1], [26, 1, 4, 1]],
  ["movem.l d0-d2,([a0],8)", [24, 1, 0, 3], [25, 1, 3, 3]],
] as [string, number[], number[]][])(
  "full-format 68030 %s",
  (source, cached, uncached) => {
    expect(
      parse(" " + source, { cpu: Cpus.MC68030 })[0].timing?.values,
    ).toEqual([uncached]);
    expect(
      parse(" " + source, {
        cpu: Cpus.MC68030,
        cacheModel: CacheModels.Cache,
      })[0].timing?.values,
    ).toEqual([cached]);
  },
);

test("brief/full displacement boundaries and resolved constants", () => {
  for (const displacement of [-128, 127]) {
    expect(
      parse(` move.l ${displacement}(a0,d0),d1`, { cpu: Cpus.MC68030 })[0]
        .timing?.values,
    ).toEqual([[8, 1, 2, 0]]);
  }
  expect(
    parse("offset equ 256\n move.l offset(a0,d0),d1", { cpu: Cpus.MC68030 })[1]
      .timing?.values,
  ).toEqual([[9, 1, 2, 0]]);
});

test("full-format lookups do not mutate later ordinary timings", () => {
  const lines = parse(
    " move.l 256(a0,d0),d1\n move.l 4(a0,d0),d1\n move.l d1,([a0])\n move.l d1,4(a0,d0)",
    { cpu: Cpus.MC68030 },
  );
  expect(lines[1].timing?.values).toEqual([[8, 1, 2, 0]]);
  expect(lines[3].timing?.values).toEqual([[7, 0, 1, 1]]);
});

test("PC-relative memory indirect cannot become a writable destination", () => {
  expect(
    parse(" move.l d0,([4,pc],d1,8)", { cpu: Cpus.MC68030 })[0].timing,
  ).toBeUndefined();
});
