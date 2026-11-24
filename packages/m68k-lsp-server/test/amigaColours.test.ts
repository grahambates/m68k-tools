import { parseFile } from "m68k-parser";
import {
  amigaColour,
  colourConstants,
  colourLiteral,
  definitionColours,
  documentColours,
} from "../src/amigaColours";

const colours = (source: string, constants: Record<string, number> = {}) =>
  documentColours(parseFile(source), (name) => constants[name]).map(
    ({ range, color }) => [
      range.start.line,
      range.start.character,
      range.end.character,
      Math.round(color.red * 15),
      Math.round(color.green * 15),
      Math.round(color.blue * 15),
    ],
  );

describe("documentColours", () => {
  test("finds values written to colour registers", () => {
    expect(
      colours(
        [
          " move.w #$0f80,color00(a6)",
          " move.w #$00F,custom+COLOR31",
          " dc.w COLOR01,$0fff,BPLCON0,$1200,COLOR02,$0400",
        ].join("\n"),
      ),
    ).toEqual([
      [0, 9, 14, 15, 8, 0],
      [1, 9, 13, 0, 0, 15],
      [2, 14, 19, 15, 15, 15],
      [2, 42, 47, 4, 0, 0],
    ]);
  });

  test("leaves out symbols, expressions and other registers", () => {
    expect(
      colours(
        [
          " move.w #RED,color00(a6)",
          " move.w #$0f00|$0080,color00(a6)",
          " move.w #$0f80,bplcon0(a6)",
          " move.w #$0f80,d0",
          " move.l #$0f800f80,color00(a6)",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("shows the colour of a constant written to a colour register", () => {
    expect(
      colours(" dc.w COLOR00,RED,COLOR01,UNKNOWN", { RED: 0xf00 }),
    ).toEqual([[0, 14, 17, 15, 0, 0]]);
  });

  test("passes over a colour register symbol defined as something else", () => {
    expect(colours(" move.w #$0f80,color00(a6)", { color00: 5 })).toEqual([]);
    expect(
      colours(" move.w #$0f80,color00(a6)", { color00: 0x180 }),
    ).toHaveLength(1);
  });

  test("shows nothing while AGA's LOCT selects the low nibbles", () => {
    expect(
      colours(
        [
          "copper:",
          " dc.w BPLCON3,$0c00,COLOR01,$0f80",
          " dc.w BPLCON3,$0e00,COLOR01,$0123",
          " dc.w BPLCON3,$0c00,COLOR02,$0080",
          " dc.w BPLCON3,UNKNOWN,COLOR03,$0800",
          "next:",
          " dc.w COLOR04,$0008",
        ].join("\n"),
      ).map(([line]) => line),
    ).toEqual([1, 3, 6]);
  });
});

describe("amigaColour", () => {
  test("reads $0RGB as four bits a component", () => {
    expect(amigaColour(0x0f80)).toEqual({
      red: 1,
      green: 8 / 15,
      blue: 0,
      alpha: 1,
    });
  });
});

describe("colourLiteral", () => {
  const orange = { red: 1, green: 8 / 15, blue: 0, alpha: 1 };

  test.each([
    ["$0000", undefined, "$0F80"],
    ["$0abc", undefined, "$0f80"],
    ["$0ABC", undefined, "$0F80"],
    ["$000", undefined, "$F80"],
    // The original's letters come first; the formatter's case decides only
    // where there are none.
    ["$0ABC", "lower", "$0F80"],
    ["$0abc", "upper", "$0f80"],
    ["$0000", "lower", "$0f80"],
    ["$0000", "any", "$0F80"],
    // Other bases stay as they were.
    ["0", undefined, "3968"],
    ["%0", undefined, "%111110000000"],
    // AGA's transparency bit, in the top four bits, is kept.
    ["$8000", undefined, "$8F80"],
  ] as const)(
    "writes over %s (case %s) as %s",
    (original, hexCase, expected) => {
      expect(colourLiteral(orange, original, hexCase)).toBe(expected);
    },
  );

  test("rounds each component to the nearest of 16 levels", () => {
    expect(
      colourLiteral({ red: 0.52, green: 0.04, blue: 0.97, alpha: 1 }, "$000"),
    ).toBe("$81F");
  });
});

describe("constants used as colours", () => {
  const parsed = parseFile(
    [
      "RED equ $f00",
      "GREY = $888",
      "WIDTH equ 320",
      "SHADE equ RED/2",
      "copper:",
      " dc.w COLOR00,RED,COLOR01,GREY,COLOR02,SHADE",
      " move.w #WIDTH,d0",
    ].join("\n"),
  );
  const constants: Record<string, number> = {
    RED: 0xf00,
    GREY: 0x888,
    WIDTH: 320,
    SHADE: 0x780,
  };

  test("names the constants written to colour registers", () => {
    expect(colourConstants(parsed, (name) => constants[name])).toEqual([
      "RED",
      "GREY",
      "SHADE",
    ]);
  });

  test("puts a swatch on a colour constant's literal definition", () => {
    const names = new Set(["RED", "GREY", "SHADE"]);
    expect(
      definitionColours(parsed, (name) => names.has(name)).map(({ range }) => [
        range.start.line,
        range.start.character,
      ]),
    ).toEqual([
      [0, 8],
      [1, 7],
    ]);
  });
});
