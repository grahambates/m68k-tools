import { matchesInstructionForms } from "../src/instructionForms";
import { instructionDocs } from "../src/docs";
import { parseFile } from "m68k-parser";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerRemapWarnings } from "../src/registerRemapValidation";

function warnings(source: string, from: string, to: string) {
  const start = source.indexOf(from);
  return registerRemapWarnings(
    TextDocument.create("file:///test.s", "m68k", 0, source),
    [
      {
        range: {
          start: { line: 0, character: start },
          end: { line: 0, character: start + from.length },
        },
        newText: to,
      },
    ],
    ["mc68000"],
  );
}

test.each([
  [" add.w d0,(a1)", "d0", "a0"],
  [" move.w d0,ccr", "d0", "a0"],
  [" move.w sr,d0", "d0", "a0"],
  [" moveq #1,d0", "d0", "a0"],
  [" lea (a0),a1", "a1", "d1"],
  [" move.w (a0),d1", "a0", "d0"],
  [" move.b d0,d1", "d1", "a1"],
  [" lsl.w #1,d0", "d0", "a0"],
])("warns about invalid register forms: %s", (source, from, to) => {
  expect(warnings(source, from, to).length).toBeGreaterThan(0);
});

test.each([
  [" move.l usp,a0", "a0", "a1"],
  [" move.l a0,usp", "a0", "a1"],
  [" move.l d0,d1", "d1", "a1"],
  [" add.w #1,d1", "d1", "a1"],
  [" lea 4(a0,d1.w),a1", "d1", "a2"],
  [" exg d0,d1", "d1", "a1"],
  [" moveq #1,a0", "a0", "a1"],
])(
  "allows legal substitutions and ignores existing errors: %s",
  (source, from, to) => {
    expect(warnings(source, from, to)).toEqual([]);
  },
);

test.each([
  [" abcd d0,d1", "d0", "a0"],
  [" addx.w d0,d1", "d1", "a1"],
  [" cmpm.w (a0)+,(a1)+", "a1", "d1"],
  [" movep.w d0,4(a0)", "d0", "a1"],
  [" or.w d0,d1", "d1", "a1"],
])("checks whole operand forms: %s", (source, from, to) => {
  expect(warnings(source, from, to).length).toBeGreaterThan(0);
});

test.each([
  [" abcd -(a0),-(a1)", "a1", "a2"],
  [" movep.w d0,4(a0)", "d0", "d2"],
  [" movep.w 4(a0),d0", "a0", "a2"],
  [" lsl.w d0,d1", "d0", "d2"],
  [" move.w sr,d0", "d0", "d1"],
])("accepts documented alternatives: %s", (source, from, to) => {
  expect(warnings(source, from, to)).toEqual([]);
});

test("does not accept a mixture of two individually valid ABCD forms", () => {
  const check = (text: string) =>
    matchesInstructionForms(
      instructionDocs.abcd,
      parseFile(text).lines[0].operands!,
    );
  expect(check(" abcd d0,d1")).toBe(true);
  expect(check(" abcd -(a0),-(a1)")).toBe(true);
  expect(check(" abcd d0,-(a1)")).toBe(false);
  expect(check(" abcd -(a0),d1")).toBe(false);
});

test("preserves unknown documentation forms rather than rejecting them", () => {
  expect(
    matchesInstructionForms(
      { ...instructionDocs.moveq, syntax: ["custom <unknown>,<unknown>"] },
      parseFile(" custom d0,a0").lines[0].operands!,
    ),
  ).toBeUndefined();
});
