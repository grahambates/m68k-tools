import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const RULE = "suspicious/dbra-word-counter";
const found = (source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === RULE,
  );

describe("suspicious/dbra-word-counter", () => {
  test("flags a longword count above 65535", () => {
    const d = found(
      [
        "clear:",
        "move.l #100000,d0",
        ".loop:",
        "clr.b (a0)+",
        "dbra d0,.loop",
        "rts",
      ].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].loc.line).toBe(5);
    expect(d[0].message).toContain("34465 times");
  });

  test("flags a counter of -1, which runs 65536 times", () => {
    const d = found(
      ["clear:", "moveq #-1,d0", ".loop:", "nop", "dbra d0,.loop", "rts"].join(
        "\n",
      ),
    );
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("65536 times");
  });

  test("accepts a count that fits in a word", () => {
    expect(
      found(
        [
          "clear:",
          "move.l #255,d0",
          ".loop:",
          "clr.b (a0)+",
          "dbra d0,.loop",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("accepts a word-sized load", () => {
    expect(
      found(
        [
          "clear:",
          "move.w #255,d0",
          ".loop:",
          "clr.b (a0)+",
          "dbra d0,.loop",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("says nothing when the count is not known", () => {
    expect(
      found(
        ["clear:", ".loop:", "clr.b (a0)+", "dbra d0,.loop", "rts"].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("ignores a counter the loop itself rewrites", () => {
    expect(
      found(
        [
          "clear:",
          "move.l #100000,d0",
          ".loop:",
          "move.w #3,d0",
          "dbra d0,.loop",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("leaves a counter packed with an outer count alone", () => {
    expect(
      found(
        [
          "grid:",
          "move.l #$00030007,d0",
          ".row:",
          ".col:",
          "clr.b (a0)+",
          "dbra d0,.col",
          "swap d0",
          "dbra d0,.row",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });
});
