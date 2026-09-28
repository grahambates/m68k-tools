import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const found = (source: string) =>
  lintSource(
    fixture(source),
    { processors: ["mc68000"] },
    undefined,
    undefined,
    undefined,
    { includedByProject: false },
  ).filter((d) => d.ruleId === "suspicious/buffer-overrun");
const allocation = "buffer: ds.b 16\nend:\n";
const loop = (
  body = "move.b (a1)+,(a0)+",
  bound = "bls .loop",
  setup = "lea buffer,a0",
  declaration = allocation,
) => `${setup}\n.loop:\n${body}\ncmpa.l #end,a0\n${bound}\nrts\n${declaration}`;

describe("suspicious/buffer-overrun", () => {
  test("catches an inclusive bound with unknown runtime data", () => {
    const d = found(loop());
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("one extra access");
    expect(d[0].message).toContain("16 bytes");
    expect(d[0].suggestion?.applicability).toBe("manual");
    expect(d[0].suggestion?.replacement).toBeUndefined();
  });
  test.each(["move.b (a0)+,d0", "clr.w (a0)+", "tst.l (a0)+"])(
    "checks reads and writes: %s",
    (body) => {
      expect(found(loop(body))).toHaveLength(1);
    },
  );
  test("accepts an exclusive bound", () =>
    expect(found(loop(undefined, "blo .loop"))).toHaveLength(0));
  test("resolves a separately loaded end pointer", () => {
    expect(
      found(
        loop(undefined, undefined, "lea buffer,a0\nlea end,a2").replace(
          "#end,a0",
          "a2,a0",
        ),
      ),
    ).toHaveLength(1);
  });
  test.each(["lea buffer(pc),a0", "move.l #buffer,a0"])(
    "recognises %s",
    (setup) => expect(found(loop(undefined, undefined, setup))).toHaveLength(1),
  );
  test.each([15, 16, -1])("checks DBRA count %s algebraically", (count) => {
    const source = `lea buffer,a0\nmove.w #${count},d0\n.loop:\nclr.b (a0)+\ndbra d0,.loop\nrts\n${allocation}`;
    expect(found(source)).toHaveLength(count === 15 ? 0 : 1);
  });
  test("accepts an unknown DBRA count", () => {
    expect(
      found(
        `lea buffer,a0\n.loop:\nclr.b (a0)+\ndbra d0,.loop\nrts\n${allocation}`,
      ),
    ).toHaveLength(0);
  });
  test.each([
    "jsr other\nclr.b (a0)+",
    "opaque_macro\nclr.b (a0)+",
    "clr.b (a0)+\naddq.l #1,a0",
    "clr.b (a0)+\nclr.b (a0)+",
    "move.l (a0)+,a0",
    "move.b (a0)+,-(a0)",
    "clr.b (a0)\naddq.l #1,a0",
    "iif UNKNOWN,clr.b (a0)+",
    "if UNKNOWN\nclr.b (a0)+\nendc",
  ])("skips ambiguous loop body %s", (body) =>
    expect(found(loop(body))).toHaveLength(0),
  );
  test.each([
    "lea other,a0",
    "lea buffer,a1\nmove.l a1,a0",
    "lea buffer,a0\njsr other",
    "lea buffer,a0\nopaque_macro",
  ])("skips ambiguous setup %s", (setup) =>
    expect(found(loop(undefined, undefined, setup))).toHaveLength(0),
  );
  test.each([
    "buffer: ds.b UNKNOWN\nend:",
    "buffer: ds.b 0\nend:",
    "if UNKNOWN\nbuffer: ds.b 16\nend:\nendc",
    "rept 2\nbuffer: ds.b 16\nend:\nendr",
    "buffer: ds.b 16\nend:\nbuffer: ds.b 16",
    "buffer: ds.b 16\nend:\nend:",
  ])("skips uncertain allocation %s", (decl) =>
    expect(found(loop(undefined, undefined, undefined, decl))).toHaveLength(0),
  );
  test("does not assume a stride reaches equality", () =>
    expect(
      found(loop("clr.l (a0)+", undefined, undefined, "buffer: ds.b 15\nend:")),
    ).toHaveLength(0));
  test("does not trust a clobbered comparison", () =>
    expect(
      found(loop().replace("bls .loop", "tst.w d0\nbls .loop")),
    ).toHaveLength(0));
  test("skips alternate entries", () =>
    expect(found("beq .loop\n" + loop())).toHaveLength(0));
  test("rejects a modified DBRA counter", () =>
    expect(
      found(
        `lea buffer,a0\nmove.w #16,d0\n.loop:\nclr.b (a0)+\nmoveq #0,d0\ndbra d0,.loop\nrts\n${allocation}`,
      ),
    ).toHaveLength(0));
});

const tableLoop = (
  table: string,
  count: number,
  start = "table",
  body = "move.b (a0)+,d1",
) =>
  `section main,code\nlea ${start}(pc),a0\nmove.w #${count},d0\n.loop:\n${body}\ndbra d0,.loop\nrts\n${table}`;

describe("table region bounds", () => {
  test("checks a PC-relative DC table after code", () => {
    const d = found(tableLoop("table: dc.b 1,2,3,4", 4));
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("beyond section main");
    expect(d[0].message).toContain("4 bytes available");
  });
  test("does not split sine and cosine views at an internal label", () => {
    const table = "table: dc.b 1,2\ncosine: dc.b 3,4";
    expect(found(tableLoop(table, 3))).toHaveLength(0);
    expect(found(tableLoop(table, 1, "cosine"))).toHaveLength(0);
    expect(found(tableLoop(table, 2, "cosine"))).toHaveLength(1);
  });
  test("resolves aliases and offsets into a table", () => {
    const table = "cosine equ table+2\ntable: dc.b 1,2,3,4";
    expect(found(tableLoop(table, 1, "cosine"))).toHaveLength(0);
    expect(found(tableLoop(table, 2, "cosine"))).toHaveLength(1);
    expect(found(tableLoop(table, 2, "table+2"))).toHaveLength(1);
  });
  test("detects accesses into interleaved code", () => {
    const d = found(
      tableLoop("table: dc.b 1,2\nresume:\nrts\ndc.b 3,4,5,6", 2),
    );
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("into code");
  });
  test("joins data across reopened sections", () => {
    const table =
      "table: dc.b 1,2\nsection other,data\ndc.b 0\nsection main,code\nrow: dc.b 3,4";
    expect(found(tableLoop(table, 3))).toHaveLength(0);
    expect(found(tableLoop(table, 4))).toHaveLength(1);
  });
  test("detects code on reopening a section", () => {
    expect(
      found(
        tableLoop(
          "table: dc.b 1,2\nsection other,data\ndc.b 0\nsection main,code\nrts",
          2,
        ),
      )[0].message,
    ).toContain("into code");
  });
  test("does not treat a different hunk as contiguous", () => {
    expect(
      found(
        tableLoop("table: dc.b 1,2\nsection other,data\ndc.b 3,4,5,6", 2),
      )[0].message,
    ).toContain("beyond section main");
  });
  test.each([
    "ds.b 4",
    "dcb.b 4,0",
    "dc.w 1,2",
    'dc.b "abcd"',
    "db 1,2,3,4",
    "dw 1,2",
    "dl 1",
  ])("sizes %s with the shared parser", (data) => {
    expect(found(tableLoop(`table: ${data}`, 3))).toHaveLength(0);
    expect(found(tableLoop(`table: ${data}`, 4))).toHaveLength(1);
  });
  test("includes known EVEN padding", () => {
    expect(found(tableLoop("table: dc.b 1,2,3\neven", 3))).toHaveLength(0);
    expect(found(tableLoop("table: dc.b 1,2,3\neven", 4))).toHaveLength(1);
  });
  test.each([
    "incbin 'blob.bin'",
    "ds.b UNKNOWN",
    "include 'more.i'",
    "opaque_macro",
    "align 16",
    "org $1000",
    "if UNKNOWN\ndc.b 1\nendc",
  ])("does not invent a bound across %s", (unknown) => {
    expect(found(tableLoop(`table: dc.b 1,2\n${unknown}`, 30))).toHaveLength(0);
  });
  test("does not require sizes of instructions preceding the table", () => {
    expect(
      found(
        tableLoop("table: dc.b 1,2", 2).replace(
          "rts\ntable",
          "bra.w external_target\ntable",
        ),
      ),
    ).toHaveLength(1);
  });
  test("does not assume an include fragment ends the section", () => {
    const src = fixture(tableLoop("table: dc.b 1,2", 2));
    for (const includedByProject of [true, undefined]) {
      expect(
        lintSource(
          src,
          { processors: ["mc68000"] },
          undefined,
          undefined,
          undefined,
          {
            includedByProject,
          },
        ).filter((d) => d.ruleId === "suspicious/buffer-overrun"),
      ).toHaveLength(0);
    }
  });
  test("can prove a code boundary even within an include fragment", () => {
    const src = fixture(tableLoop("table: dc.b 1,2\nrts", 2));
    expect(
      lintSource(
        src,
        { processors: ["mc68000"] },
        undefined,
        undefined,
        undefined,
        {
          includedByProject: true,
        },
      ).filter((d) => d.ruleId === "suspicious/buffer-overrun"),
    ).toHaveLength(1);
  });
  test("an internal label used as an inclusive bound is not a region boundary", () => {
    expect(
      found(
        loop(
          undefined,
          undefined,
          undefined,
          "buffer: dc.b 1,2\nend:\ndc.b 3,4",
        ),
      ),
    ).toHaveLength(0);
  });
  test("checks both sides of a copy independently", () => {
    const src = tableLoop(
      "table: dc.b 1,2\nrts\nother: dc.b 1,2\nrts",
      2,
      "table",
      "move.b (a0)+,(a1)+",
    ).replace("move.w #2,d0", "lea other(pc),a1\nmove.w #2,d0");
    expect(found(src)).toHaveLength(2);
  });
});

describe("layout certainty", () => {
  test("an end label attached to code is a valid inclusive boundary", () => {
    expect(
      found(
        loop(undefined, undefined, undefined, "buffer: dc.b 1,2\nend: rts"),
      )[0].message,
    ).toContain("into code");
  });
  test("accounts for alignment in a data-only section", () => {
    const table = "section tables,data\ntable: dc.b 1\nalign 4\nend:";
    expect(found(tableLoop(table, 3))).toHaveLength(0);
    expect(found(tableLoop(table, 4))).toHaveLength(1);
  });
  test("accounts for CNOP after instructions using known parity", () => {
    const table = "table: dc.b 1,2,3\ncnop 0,2";
    expect(found(tableLoop(table, 3))).toHaveLength(0);
    expect(found(tableLoop(table, 4))).toHaveLength(1);
  });
  test("keeps local labels scoped", () => {
    const src =
      "first:\nlea .table(pc),a0\nmoveq #2,d0\n.loop:\nmove.b (a0)+,d1\ndbra d0,.loop\nrts\n.table: dc.b 1,2\nsecond:\nrts\n.table: dc.b 1,2,3,4";
    expect(found(src)).toHaveLength(1);
  });
  test("known inactive data does not extend a table", () => {
    expect(
      found(tableLoop("table: dc.b 1,2\nif 0\ndc.b 3,4\nendc", 2)),
    ).toHaveLength(1);
  });
  test("unknown output in a reopened section invalidates the earlier extent", () => {
    expect(
      found(
        tableLoop(
          "table: dc.b 1,2\nsection other,data\ndc.b 0\nsection main,code\nincbin 'blob.bin'",
          5,
        ),
      ),
    ).toHaveLength(0);
  });
  test("opaque includes can append to sections other than the current one", () => {
    expect(
      found(
        tableLoop("table: dc.b 1,2\nsection other,data\ninclude 'extra.i'", 5),
      ),
    ).toHaveLength(0);
  });
  test("unknown preceding output does not hide a later known data-to-code extent", () => {
    expect(
      found(tableLoop("incbin 'blob.bin'\ntable: dc.b 1,2\nrts", 2)),
    ).toHaveLength(1);
  });
  test("alias cycles remain unknown", () => {
    expect(
      found(tableLoop("alias equ alias\ntable: dc.b 1,2", 4, "alias")),
    ).toHaveLength(0);
  });
});
