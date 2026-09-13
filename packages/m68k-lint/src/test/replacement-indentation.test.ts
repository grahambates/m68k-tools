import { parseFile } from "m68k-parser";
import { lintSource } from "../core/lint.js";

/**
 * A replacement adopts the indentation of the code it replaces.
 *
 * Rules emit compact text starting in column zero, which is not valid
 * assembly: a token in column zero is a label, so a multi-line replacement
 * pasted as written defines a label per line and assembles nothing like the
 * intent. This matters for copy and paste today and for applying fixes
 * automatically later.
 */
function replacementFor(source: string, ruleId: string): string | undefined {
  return lintSource(source, { processors: ["mc68000"] }).find(
    (d) => d.ruleId === ruleId,
  )?.suggestion?.replacement;
}

describe("replacements adopt the source indentation", () => {
  test("a single-line replacement is indented like the line it replaces", () => {
    const found = replacementFor(
      "start:\n\tmove.l\t#100,d0\n\trts",
      "optimization/prefer-moveq",
    );
    // The source separates its operands with a tab, so the replacement does too.
    expect(found).toBe("\tmoveq\t#100,d0");
  });

  test("every line of a multi-line replacement is indented, not just the first", () => {
    const found = replacementFor(
      "start:\n\tmuls.w\t#10,d0\n\tmove.l\td1,d2\n\trts",
      "optimization/muls-word-selected-constants",
    );
    expect(found).toBeDefined();
    for (const line of found!.split("\n")) expect(line).toMatch(/^\t\S/);
  });

  test("spaces are matched rather than replaced with a tab", () => {
    const found = replacementFor(
      "start:\n    move.l #100,d0\n    rts",
      "optimization/prefer-moveq",
    );
    expect(found).toBe("    moveq #100,d0");
  });

  test("an unusual indent width is preserved exactly", () => {
    const found = replacementFor(
      "start:\n      move.l #100,d0\n      rts",
      "optimization/prefer-moveq",
    );
    expect(found).toBe("      moveq #100,d0");
  });

  // A label occupies column zero, so the instruction's own indentation is the
  // gap between the label and the mnemonic. The label itself is kept, since
  // dropping it would break every branch to it.
  test("a label on the same line is carried across with the indent", () => {
    const found = replacementFor(
      "start:\tmove.l\t#100,d0\n\trts",
      "optimization/prefer-moveq",
    );
    expect(found).toBe("start:\tmoveq\t#100,d0");
  });

  test("a deletion stays empty rather than becoming whitespace", () => {
    const found = replacementFor(
      "\tmove.w #100,d0\n\tmove.w #200,d0\n\trts",
      "suspicious/dead-register-write",
    );
    expect(found).toBe("");
  });

  test("indented replacements still parse as instructions", () => {
    const found = replacementFor(
      "start:\n\tmuls.w\t#10,d0\n\tmove.l\td1,d2\n\trts",
      "optimization/muls-word-selected-constants",
    );
    // The point of the indentation: parsed on its own, every line is an
    // instruction. Unindented, each would parse as a label instead.
    const parsed = parseFile(found!);
    expect(parsed.lines).toHaveLength(5);
    for (const line of parsed.lines) {
      expect(line.mnemonic?.type).toBe("instruction");
      expect(line.label).toBeUndefined();
    }

    // The same text without indentation is what the parser would have been
    // given before, and it produces labels rather than instructions.
    const unindented = parseFile(found!.replace(/^\t/gm, ""));
    expect(
      unindented.lines.every((line) => line.mnemonic?.type === "instruction"),
    ).toBe(false);
  });

  describe("operand alignment", () => {
    /** The column the operands begin in, counting a tab as advancing to the next stop. */
    const operandColumn = (
      line: string,
      tabWidth: number,
    ): number | undefined => {
      const parts = /^([ \t]*\S+)([ \t]+)\S/.exec(line);
      if (!parts) return undefined;
      let column = 0;
      for (const char of parts[1] + parts[2]) {
        column =
          char === "\t"
            ? (Math.floor(column / tabWidth) + 1) * tabWidth
            : column + 1;
      }
      return column;
    };

    test("a tab-separated source gives a tab-separated replacement", () => {
      expect(
        replacementFor(
          "start:\n\tmove.l\t#100,d0\n\trts",
          "optimization/prefer-moveq",
        ),
      ).toBe("\tmoveq\t#100,d0");
    });

    // Tabs land on stops, so reproducing them keeps the columns together at the
    // widths people set. It is not unconditional: a tab narrow enough that the
    // two mnemonics fall in different cells separates them, which is equally
    // true of tab-aligned source written by hand.
    test("every line of a multi-line replacement lands in the source's column", () => {
      const source = "start:\n\tmuls.w\t#10,d0\n\tmove.l\td1,d2\n\trts";
      const found = replacementFor(
        source,
        "optimization/muls-word-selected-constants",
      );
      expect(found).toBeDefined();
      for (const tabWidth of [8, 4]) {
        const want = operandColumn("\tmuls.w\t#10,d0", tabWidth);
        for (const line of found!.split("\n"))
          expect(operandColumn(line, tabWidth)).toBe(want);
      }
    });

    test("a space-aligned source is matched in spaces", () => {
      const found = replacementFor(
        "start:\n    move.l    #100,d0\n    rts",
        "optimization/prefer-moveq",
      );
      expect(found).toBe("    moveq     #100,d0");
      expect(operandColumn(found!, 8)).toBe(
        operandColumn("    move.l    #100,d0", 8),
      );
    });

    // A single space is a separator, not an alignment; padding a shorter
    // mnemonic out to that column would produce `moveq  #100,d0` from source
    // that never lined anything up.
    test("a single space is left as a single space", () => {
      expect(
        replacementFor(
          "start:\n\tmove.l #100,d0\n\trts",
          "optimization/prefer-moveq",
        ),
      ).toBe("\tmoveq #100,d0");
    });

    test("a replacement with no operands is unaffected", () => {
      const found = replacementFor(
        "\tandi.w\t#$ffff,d0\n\tmove.l\td1,d2\n\trts",
        "optimization/andi-all-ones-to-tst",
      );
      expect(found).toBe("\ttst.w\td0");
    });
  });
});
