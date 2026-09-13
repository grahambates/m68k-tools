import { parseFile } from "m68k-parser";
import { instructionDocs } from "../src/docs";
import { matchesInstructionForms } from "../src/instructionForms";

// Exercise every base-68000 documentation entry, including condition-code variants.
const base = Object.entries(instructionDocs).filter(
  ([, doc]) => doc.procs.mc68000,
);
test.each(base)("recognises documented operand forms for %s", (_name, doc) => {
  expect(doc.syntax.length).toBeGreaterThan(0);
  for (const signature of doc.syntax) {
    const operands = signature.includes(" ")
      ? signature.slice(signature.indexOf(" ") + 1)
      : "";
    const optional = /\[([^[\]]*)\]/.exec(operands);
    const variants = optional
      ? [
          operands.replace(optional[0], ""),
          operands.replace(optional[0], optional[1]),
        ]
      : [operands];
    for (const variant of variants) {
      const text = variant
        .replace(/#<[^>]+>/g, "#1")
        .replace(/<source>/g, "(a0)")
        .replace(
          /<destination>/g,
          doc.dest?.dn || (!doc.dest && doc.src?.dn) ? "d1" : "(a1)",
        )
        .replace(/<(label|literal)>/g, "target")
        .replace(/<(count|bit_number)>/g, "#1")
        .replace(/<register_list>/g, "d0-d1/a0")
        .replace(/\bD[nxy]\b/gi, "d0")
        .replace(/\bA[nxy]\b/gi, "a0")
        .replace(/\bR[nxy]\b/gi, "d0")
        .replace(/\(d,/g, "(4,");
      const parsed = parseFile(` ${_name} ${text}`);
      expect(parsed.errors, text).toEqual([]);
      expect(
        matchesInstructionForms(doc, parsed.lines[0].operands ?? []),
        `${_name} ${text}`,
      ).toBe(true);
    }
  }
});

test.each([
  ["jmp", " $1234.w"],
  ["jmp", " target"],
  ["bra", " target"],
  ["eori", " #1,d0"],
  ["eori", " #1,ccr"],
  ["eori", " #1,sr"],
  ["move", " sr,d0"],
  ["move", " a0,usp"],
])("accepts %s %s", (name, operands) => {
  expect(
    matchesInstructionForms(
      instructionDocs[name],
      parseFile(` ${name}${operands}`).lines[0].operands!,
    ),
  ).toBe(true);
});

test.each([
  ["add", " a0,(a1)"],
  ["and", " (a0),(a1)"],
  ["move", " a0,ccr"],
  ["bra", " a0"],
  ["jmp", " d0"],
  ["eori", " #1,a0"],
  ["movea", " sr,a0"],
  ["add", " sr,d0"],
  ["lea", " #1,a0"],
])("rejects %s %s", (name, operands) => {
  expect(
    matchesInstructionForms(
      instructionDocs[name],
      parseFile(` ${name}${operands}`).lines[0].operands!,
    ),
  ).toBe(false);
});
