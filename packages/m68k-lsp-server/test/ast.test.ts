import { parseFile, parseLine } from "m68k-parser";

import {
  childNodes,
  closestAncestor,
  containsColumn,
  lineAt,
  lineNodes,
  nodeAtColumn,
  nodeAtPosition,
  walkFile,
  walkLine,
} from "../src/ast";
import { locationAsRange } from "m68k-parser";

const line = (text: string) => parseLine(text).value;

describe("ast", () => {
  describe("#lineNodes()", () => {
    it("returns line components in source order", () => {
      const nodes = lineNodes(line("Label:  move.w  #1,d0  ; note"));
      expect(nodes.map((n) => n.type)).toEqual([
        "label",
        "instruction",
        "size",
        "immediate",
        "data-register",
        "comment",
      ]);
    });

    it("returns nothing for a blank line", () => {
      expect(lineNodes(line(""))).toEqual([]);
    });

    it("skips non-node properties", () => {
      // `raw` on a register list is a string array, not child nodes.
      const nodes = lineNodes(line("  movem.l d0-d7/a0-a6,-(sp)"));
      const list = nodes.find((n) => n.type === "register-list");
      expect(list).toBeTruthy();
      expect(childNodes(list!)).toEqual([]);
    });
  });

  describe("#childNodes()", () => {
    it("descends into an operand", () => {
      const [immediate] = lineNodes(line("  move.w #$1234,d0")).filter(
        (n) => n.type === "immediate",
      );
      expect(childNodes(immediate).map((n) => n.type)).toEqual([
        "numeric-literal",
      ]);
    });

    it("returns children in source order", () => {
      const [operand] = lineNodes(line("  move.w 8(a0,d1.w),d0")).filter(
        (n) => n.type === "address-register-indirect-index",
      );
      const starts = childNodes(operand).map((n) => n.loc.start);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    });
  });

  describe("#walkLine()", () => {
    it("visits nested nodes, parents before children", () => {
      const types = walkLine(line("  move.w #(1+2),d0")).map((n) => n.type);
      expect(types).toContain("immediate");
      expect(types).toContain("binary-op");
      expect(types.indexOf("immediate")).toBeLessThan(
        types.indexOf("binary-op"),
      );
    });
  });

  describe("#containsColumn()", () => {
    const loc = { start: 4, end: 8 };

    it("excludes a column before the node", () => {
      expect(containsColumn(loc, 3)).toBe(false);
    });

    it("includes the start", () => {
      expect(containsColumn(loc, 4)).toBe(true);
    });

    it("includes the end so a trailing cursor still matches", () => {
      expect(containsColumn(loc, 8)).toBe(true);
    });

    it("excludes a column past the end", () => {
      expect(containsColumn(loc, 9)).toBe(false);
    });
  });

  describe("#nodeAtColumn()", () => {
    //                    0123456789012345678901
    const text = "Label:  move.w  #$12,d0";

    it("finds the label", () => {
      expect(nodeAtColumn(line(text), 2)?.node.type).toBe("label");
    });

    it("finds the mnemonic", () => {
      expect(nodeAtColumn(line(text), 10)?.node.type).toBe("instruction");
    });

    it("finds the size qualifier", () => {
      expect(nodeAtColumn(line(text), 13)?.node.type).toBe("size");
    });

    it("descends to the innermost node of an operand", () => {
      const path = nodeAtColumn(line(text), 18);
      expect(path?.node.type).toBe("numeric-literal");
      expect(path?.ancestors.map((a) => a.type)).toEqual(["immediate"]);
    });

    it("finds a later operand", () => {
      expect(nodeAtColumn(line(text), 21)?.node.type).toBe("data-register");
    });

    it("returns undefined in trailing whitespace", () => {
      expect(nodeAtColumn(line("  rts       "), 11)).toBeUndefined();
    });

    it("returns undefined for a blank line", () => {
      expect(nodeAtColumn(line(""), 0)).toBeUndefined();
    });

    it("prefers the earlier node where two meet at a boundary", () => {
      // Cursor between `d0` and the comma belongs to `d0`.
      const path = nodeAtColumn(line("  move.w d0,d1"), 11);
      expect(path?.node.type).toBe("data-register");
      expect(path?.node.loc.start).toBe(9);
    });
  });

  describe("#nodeAtPosition()", () => {
    const file = parseFile("Start:\n\n  move.w #1,d0\n  rts\n");

    it("maps a zero-based line to the right parsed line", () => {
      expect(nodeAtPosition(file, { line: 2, character: 3 })?.node.type).toBe(
        "instruction",
      );
    });

    it("finds a node on the first line", () => {
      expect(nodeAtPosition(file, { line: 0, character: 1 })?.node.type).toBe(
        "label",
      );
    });

    it("returns undefined on a blank line", () => {
      expect(nodeAtPosition(file, { line: 1, character: 0 })).toBeUndefined();
    });

    it("returns undefined past the end of the document", () => {
      expect(nodeAtPosition(file, { line: 99, character: 0 })).toBeUndefined();
    });
  });

  describe("#lineAt()", () => {
    it("keeps one entry per source line, including blanks", () => {
      const file = parseFile("Start:\n\n\n  rts\n");
      expect(file.lines).toHaveLength(5);
      expect(lineAt(file, 0)?.label).toBeTruthy();
      expect(lineAt(file, 1)?.mnemonic).toBeUndefined();
      expect(lineAt(file, 3)?.mnemonic).toBeTruthy();
    });
  });

  describe("#walkFile()", () => {
    it("pairs every node with its line", () => {
      const file = parseFile("Start:\n  move.w #1,d0\n");
      const found = walkFile(file);
      const label = found.find((f) => f.node.type === "label");
      const register = found.find((f) => f.node.type === "data-register");
      expect(label?.line.lineNumber).toBe(1);
      expect(register?.line.lineNumber).toBe(2);
    });
  });

  describe("#closestAncestor()", () => {
    it("finds an enclosing node by type", () => {
      const path = nodeAtColumn(line("  move.w #(1+2),d0"), 12)!;
      expect(closestAncestor(path, "immediate")?.type).toBe("immediate");
    });

    it("returns undefined when no ancestor matches", () => {
      const path = nodeAtColumn(line("  move.w #1,d0"), 13)!;
      expect(closestAncestor(path, "bitfield")).toBeUndefined();
    });
  });

  describe("#locationAsRange()", () => {
    it("converts a one-based parser line to a zero-based range", () => {
      const file = parseFile("Start:\n  move.w #1,d0\n");
      const mnemonic = file.lines[1].mnemonic!;
      expect(mnemonic.loc.line).toBe(2);
      expect(locationAsRange(mnemonic.loc)).toEqual({
        start: { line: 1, character: 2 },
        end: { line: 1, character: 6 },
      });
    });

    it("falls back to line 0 when the location carries no line", () => {
      // `parseLine` locations have no `line` of their own.
      const mnemonic = line("  rts").mnemonic!;
      expect(mnemonic.loc.line).toBeUndefined();
      expect(locationAsRange(mnemonic.loc).start.line).toBe(0);
    });

    it("uses an explicit line over the one in the location", () => {
      const file = parseFile("Start:\n  rts\n");
      const mnemonic = file.lines[1].mnemonic!;
      expect(locationAsRange(mnemonic.loc, 7).start.line).toBe(7);
    });
  });
});
