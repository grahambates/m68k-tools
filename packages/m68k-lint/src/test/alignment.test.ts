import { lintSource } from "../core/lint.js";
import type { LintConfig } from "../core/config.js";
import { fixture } from "./helpers.js";

const found = (
  rule: string,
  source: string,
  config: LintConfig = { processors: ["mc68000"] },
) => lintSource(fixture(source), config).filter((d) => d.ruleId === rule);

describe("suspicious/missing-even", () => {
  const RULE = "suspicious/missing-even";

  test("flags an instruction after odd-length data", () => {
    const d = found(RULE, ["msg: dc.b 'abc'", "moveq #0,d0"].join("\n"));
    expect(d).toHaveLength(1);
    expect(d[0].loc.line).toBe(2);
  });

  test("flags word data after odd-length data", () => {
    const d = found(RULE, ["msg: dc.b 1,2,3", "table: dc.w 1"].join("\n"));
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("Word-sized data");
  });

  test("reports one odd stretch once", () => {
    expect(
      found(RULE, ["dc.b 1", "dc.w 1", "dc.w 2", "moveq #0,d0"].join("\n")),
    ).toHaveLength(1);
  });

  test("an even count of bytes is fine", () => {
    expect(
      found(RULE, ["msg: dc.b 'ab'", "moveq #0,d0"].join("\n")),
    ).toHaveLength(0);
  });

  test("EVEN restores alignment", () => {
    expect(
      found(RULE, ["dc.b 1", "even", "moveq #0,d0"].join("\n")),
    ).toHaveLength(0);
  });

  test("CNOP restores alignment", () => {
    expect(
      found(RULE, ["dc.b 1", "cnop 0,4", "moveq #0,d0"].join("\n")),
    ).toHaveLength(0);
  });

  test("ds.b and dcb.b count too", () => {
    expect(found(RULE, ["ds.b 3", "moveq #0,d0"].join("\n"))).toHaveLength(1);
    expect(found(RULE, ["dcb.b 4,0", "moveq #0,d0"].join("\n"))).toHaveLength(
      0,
    );
  });

  test("says nothing once the size is unknown", () => {
    expect(
      found(RULE, ["dc.b 1", "incbin 'x.bin'", "moveq #0,d0"].join("\n")),
    ).toHaveLength(0);
    expect(
      found(RULE, ["dc.b 1", "mymacro", "moveq #0,d0"].join("\n")),
    ).toHaveLength(0);
  });

  test("each section keeps its own position", () => {
    expect(
      found(
        RULE,
        ["section a,code", "dc.b 1", "section b,data", "moveq #0,d0"].join(
          "\n",
        ),
      ),
    ).toHaveLength(0);
  });

  test("db, blk.b and an unsized dc are understood too", () => {
    expect(found(RULE, ["db 1", "moveq #0,d0"].join("\n"))).toHaveLength(1);
    expect(found(RULE, ["blk.b 3", "moveq #0,d0"].join("\n"))).toHaveLength(1);
    // An unsized dc is a word, so it leaves the address as it was.
    expect(found(RULE, ["dc 1,2,3", "moveq #0,d0"].join("\n"))).toHaveLength(0);
  });

  test("a count from a constant the file defines", () => {
    expect(
      found(RULE, ["N equ 3", "ds.b N", "moveq #0,d0"].join("\n")),
    ).toHaveLength(1);
    expect(
      found(RULE, ["N equ 4", "ds.b N", "moveq #0,d0"].join("\n")),
    ).toHaveLength(0);
  });

  test("a backslash in a string is a character, so it counts", () => {
    // "a\n" is three bytes, which leaves the address odd.
    expect(found(RULE, ['dc.b "a\\n"', "moveq #0,d0"].join("\n"))).toHaveLength(
      1,
    );
  });

  test("wider data with a count that is not known leaves the address alone", () => {
    expect(
      found(RULE, ["dc.b 1", "ds.w count", "moveq #0,d0"].join("\n")),
    ).toHaveLength(1);
  });

  test("word data is left alone on a 68020", () => {
    const config = { processors: ["mc68020" as const] };
    expect(found(RULE, ["dc.b 1", "dc.w 1"].join("\n"), config)).toHaveLength(
      0,
    );
    expect(
      found(RULE, ["dc.b 1", "moveq #0,d0"].join("\n"), config),
    ).toHaveLength(1);
  });
});

describe("suspicious/odd-address-access", () => {
  const RULE = "suspicious/odd-address-access";

  test("flags a word access to an odd constant", () => {
    const d = found(RULE, "move.w $10001,d0");
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe("error");
  });

  test("a byte access to an odd address is fine", () => {
    expect(found(RULE, "move.b $10001,d0")).toHaveLength(0);
  });

  test("an even address is fine", () => {
    expect(found(RULE, "move.l $10000,d0")).toHaveLength(0);
  });

  test("follows a constant through an equate", () => {
    expect(
      found(RULE, ["base equ $10001", "move.l base,d0"].join("\n")),
    ).toHaveLength(1);
  });

  test("follows an address register holding a known value", () => {
    expect(
      found(RULE, ["lea $10001,a0", "move.w (a0),d0"].join("\n")),
    ).toHaveLength(1);
    expect(
      found(RULE, ["lea $10000,a0", "move.w 1(a0),d0"].join("\n")),
    ).toHaveLength(1);
    expect(
      found(RULE, ["lea $10000,a0", "move.w 2(a0),d0"].join("\n")),
    ).toHaveLength(0);
  });

  test("follows a label on byte data placed at an odd offset", () => {
    const d = found(
      RULE,
      ["dc.b 1", "text: dc.b 'hello'", "move.w text,d0"].join("\n"),
    );
    expect(d).toHaveLength(1);
  });

  test("label plus an odd offset can fix the parity", () => {
    expect(
      found(
        RULE,
        ["dc.b 1", "text: dc.b 'hello'", "move.w text+1,d0"].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("leaves a label on word data to missing-even", () => {
    expect(
      found(RULE, ["dc.b 1", "table: dc.w 1", "move.w table,d0"].join("\n")),
    ).toHaveLength(0);
  });

  test("does not apply to a 68020", () => {
    expect(
      found(RULE, "move.w $10001,d0", { processors: ["mc68020"] }),
    ).toHaveLength(0);
  });

  test("LEA and PEA do not access memory", () => {
    expect(found(RULE, "lea.l $10001,a0")).toHaveLength(0);
  });
});
