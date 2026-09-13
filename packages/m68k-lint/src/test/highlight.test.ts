import { COLORS, highlightAsm } from "../cli/format.js";

/**
 * Terminal syntax highlighting. The escape sequences occupy no columns, which
 * is what lets the caret underlining a diagnostic stay aligned with the line
 * above it.
 *
 * Assertions are built from the palette rather than from colour codes written
 * out here, so that retuning a colour is not a test failure. What is asserted
 * is which category a token falls in, which is the part that has to be right.
 */
const ESC = "\u001b";
const OFF = `${ESC}[0m`;
const as = (kind: keyof typeof COLORS, text: string) =>
  `${ESC}[${COLORS[kind]}m${text}${OFF}`;

const paint = (text: string, color: boolean = true) =>
  highlightAsm(text, color);

/** The line with every escape sequence removed, as the terminal renders its width. */
const visible = (text: string) =>
  text.replace(new RegExp(`${ESC}\\[\\d+m`, "g"), "");

describe("assembly highlighting", () => {
  test("colour is off unless asked for", () => {
    const line = "\tmove.l\t#100,d0\t; a comment";
    expect(highlightAsm(line, false)).toBe(line);
  });

  test("never changes the visible text", () => {
    for (const line of [
      "\tmove.l\t#100,d0",
      "SCREEN_BW\tequ\t320",
      "start:",
      "\tmuls.w\t#10,d0\t\t; scale by ten",
      "\tmove.w\t#DMAF_SETCLR!DMAF_COPPER,$dff096",
      "\tlea\tSCREEN_BW/2(a3),a3",
      "* a banner comment",
      "",
      "   ",
    ]) {
      expect(visible(paint(line))).toBe(line);
    }
  });

  test("splits the mnemonic from its size qualifier", () => {
    expect(paint("\tmove.l\td0,d1")).toContain(
      `${as("mnemonic", "move")}${as("size", ".l")}`,
    );
  });

  test("a mnemonic with no size is left whole", () => {
    expect(paint("\tdbf\td7,.loop")).toContain(`${as("mnemonic", "dbf")}`);
  });

  test("registers, literals and punctuation each get their own colour", () => {
    const out = paint("\tmove.l\t#100,d0");
    expect(out).toContain(as("literal", "100"));
    expect(out).toContain(as("register", "d0"));
    expect(out).toContain(as("punctuation", "#"));
    expect(out).toContain(as("punctuation", ","));
  });

  test("numbers are recognised in every base an assembler takes", () => {
    expect(paint("\tmove.w\t#$dff096,d0")).toContain(as("literal", "$dff096"));
    expect(paint("\tmove.w\t#%1010,d0")).toContain(as("literal", "%1010"));
    expect(paint("\tmove.w\t#@777,d0")).toContain(as("literal", "@777"));
  });

  // The names carrying the meaning stay the most readable thing on the line.
  test("symbols and labels are left uncoloured", () => {
    expect(paint("\tlea\tSCREEN_BW(a3),a3")).toContain("SCREEN_BW");
    expect(paint("\tlea\tSCREEN_BW(a3),a3")).not.toContain(
      as("mnemonic", "SCREEN_BW"),
    );
    expect(paint("start:")).toBe("start:");
  });

  describe("labels only exist in column zero", () => {
    test("an indented mnemonic is not mistaken for a label", () => {
      expect(paint("\tmuls.w\t#10,d0")).toContain(as("mnemonic", "muls"));
    });

    test("a column-zero label leaves the operation after it coloured", () => {
      const out = paint("SCREEN_BW\tequ\t320");
      expect(out).toContain(as("mnemonic", "equ"));
      expect(out.startsWith("SCREEN_BW")).toBe(true);
    });

    test("a label and an instruction on one line", () => {
      const out = paint("start:\tmove.l\t#1,d0");
      expect(out.startsWith("start:")).toBe(true);
      expect(out).toContain(`${as("mnemonic", "move")}${as("size", ".l")}`);
    });
  });

  // Structure comes from the parser, so these cost nothing to get right here.
  // A regex re-deriving them got the first of them wrong.
  describe("cases the parser settles", () => {
    test("an indented mnemonic is never read as a label", () => {
      expect(paint("\tmuls.w\t#10,d0")).toContain(as("mnemonic", "muls"));
    });

    test("a dot in a name is not a size qualifier", () => {
      const out = paint("\tdbf\td7,.loop");
      // The whole mnemonic is one span: no part of it is taken for a size.
      expect(out).toContain(as("mnemonic", "dbf"));
      expect(out).toContain(".loop");
    });

    test("a local label in column zero is still a label", () => {
      const out = paint(".loop:\tmove.b\t-(a1),d2");
      expect(out.startsWith(".loop:")).toBe(true);
      expect(out).toContain(`${as("mnemonic", "move")}${as("size", ".b")}`);
    });

    test("a branch size is a size", () => {
      expect(paint("\tbsr.s\tmy_sub")).toContain(
        `${as("mnemonic", "bsr")}${as("size", ".s")}`,
      );
    });

    test("postincrement punctuation inside an operand", () => {
      const out = paint("\tmove.l\t(a0)+,d0");
      expect(out).toContain(as("register", "a0"));
      expect(visible(out)).toBe("\tmove.l\t(a0)+,d0");
    });

    test("a line that is not assembly is returned intact", () => {
      const text = "\t!!! not assembly at all";
      expect(visible(paint(text))).toBe(text);
    });
  });

  describe("comments", () => {
    test("a trailing comment is dimmed whole", () => {
      expect(paint("\tnop\t; explain")).toContain(as("comment", "; explain"));
    });

    test("a banner comment in column zero is dimmed whole", () => {
      expect(paint("* a banner comment")).toBe(
        as("comment", "* a banner comment"),
      );
    });

    test("a semicolon inside a string does not start a comment", () => {
      const out = paint('\tdc.b\t"a;b",0');
      expect(out).toContain(as("literal", '"a;b"'));
      expect(out).not.toContain(`${ESC}[${COLORS.comment}m;b"`);
    });
  });
});
