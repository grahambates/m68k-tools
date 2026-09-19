import { parseFile } from "../file-parser.js";
import { parseLine } from "../line-parser.js";
import {
  childNodes,
  descendants,
  isAstNode,
  lineNodes,
  walkFile,
  walkLine,
} from "../ast-walk.js";

describe("ast walking", () => {
  const line = parseLine(" move.l 4(a0),d1").value;

  it("recognises a node by its type and location", () => {
    expect(isAstNode({ type: "x", loc: { start: 0, end: 1 } })).toBe(true);
    expect(isAstNode({ type: "x" })).toBe(false);
    expect(isAstNode(null)).toBe(false);
  });

  it("lists a line's components in source order", () => {
    expect(lineNodes(line).map((n) => n.type)).toEqual([
      "instruction",
      "size",
      "address-register-indirect-displacement",
      "data-register",
    ]);
  });

  it("walks every node on a line, parents before children", () => {
    expect(walkLine(line).map((n) => n.type)).toEqual([
      "instruction",
      "size",
      "address-register-indirect-displacement",
      "numeric-literal",
      "address-register",
      "data-register",
    ]);
  });

  it("gives a node's children and all its descendants", () => {
    const [, , operand] = lineNodes(line);
    expect(childNodes(operand).map((n) => n.type)).toEqual([
      "numeric-literal",
      "address-register",
    ]);
    expect(descendants(operand)).toHaveLength(2);
  });

  it("walks a file with the line each node came from", () => {
    const file = parseFile(" nop\n moveq #1,d0\n");
    const walked = walkFile(file);
    expect(walked[0].node.type).toBe("instruction");
    expect(walked[0].line).toBe(file.lines[0]);
    expect(walked.at(-1)?.line).toBe(file.lines[1]);
  });
});
