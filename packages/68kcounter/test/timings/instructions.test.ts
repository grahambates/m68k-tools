/**
 * Parses and asserts correct timings for every instruction in `instructions.s`
 */

import fs from "fs";
import parse from "../../src/parse";
import evaluate from "../../src/parse/evaluate";
import { type Timing } from "../../src/timings";

const instructions = fs
  .readFileSync(__dirname + "/../examples/instructions.s")
  .toString();

/**
 * Extract expected timings from line comment
 */
function parseComment(
  comment: string,
  m?: number,
): { total: Timing; index: number } {
  let index = 0;
  const [timings, caseText] = comment
    .substr(1)
    .split(";")
    .map((n) => n.trim());

  // The comment suffix determines which timing we looks at where there are multiple values
  switch (caseText) {
    case "Branch not taken":
    case "Branch not taken, cc true":
    case "cc true":
    case "Trap":
    case "Trap, d0 > <ea>":
      index = 1;
      break;
    case "Branch not taken, counter expired":
    case "Trap, d0 < 0":
      index = 2;
      break;
  }

  if (timings.includes("=")) {
    const total = parseTime(timings.split("=").pop().trim(), m);
    return { total, index };
  }
  return {
    total: parseTime(timings, m),
    index,
  };
}

/**
 * Convert string formatted timing 'x(y/z)'
 */
const parseTime = (str: string, m?: number): Timing =>
  str
    .match(/([\d+m]+)\(([\d+m]+)\/([\d+m]+)\)/)
    .slice(1)
    .map((n) => evaluate(n.replace(/(\d)m/, "$1*m"), { m })) as Timing;

describe("instruction timings", () => {
  const lines = parse(instructions);
  for (let i = 0; i < lines.length; i++) {
    const { statement, timing } = lines[i];
    if (
      // Does this look like it should be an instruction?
      // Don't rely on `isInstruction()` as this won't catch unsupported mnemonics
      !statement.isDirective() &&
      !statement.isLabel() &&
      statement.text.trim() && // ignore empty lines
      !statement.text.match(/^\s*;/) // ignore comment-only lines
    ) {
      test(statement.text, () => {
        expect(statement.isInstruction()).toBeTruthy();
        const { values: timings, calculation } = timing;
        const m = Array.isArray(calculation.n)
          ? calculation.n[0]
          : calculation.n;
        const { total, index } = parseComment(statement.comment.text, m);
        const idx = Math.min(index, timings.length - 1);
        expect(timings[idx]).toEqual(total);
      });
    }
  }
});
