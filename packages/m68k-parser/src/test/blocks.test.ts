import { parseFile } from "../index.js";
import {
  blockAt,
  blockRole,
  enclosingBlocks,
  parseBlocks,
} from "../block-parser.js";
import { parseLine } from "../line-parser.js";

const blocks = (src: string) => parseBlocks(parseFile(src));

describe("parseBlocks", () => {
  describe("pairing", () => {
    it("pairs a macro with its endm and takes the name from the label", () => {
      const { blocks: found, errors } = blocks(
        "Foo macro\n move d0,d1\n endm\n",
      );
      expect(errors).toHaveLength(0);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        kind: "macro",
        name: "Foo",
        start: 0,
        end: 2,
      });
    });

    it("pairs rept with endr", () => {
      const { blocks: found } = blocks(" rept 4\n nop\n endr\n");
      expect(found[0]).toMatchObject({ kind: "repeat", start: 0, end: 2 });
    });

    it("accepts either terminator for a conditional", () => {
      expect(blocks(" ifeq 1\n nop\n endc\n").blocks[0]).toMatchObject({
        kind: "conditional",
        end: 2,
      });
      expect(blocks(" ifeq 1\n nop\n endif\n").blocks[0]).toMatchObject({
        kind: "conditional",
        end: 2,
      });
    });

    it("records the arms of a conditional", () => {
      const { blocks: found } = blocks(
        " ifeq 1\n nop\n elseif 2\n nop\n else\n nop\n endc\n",
      );
      expect(found[0]).toMatchObject({
        kind: "conditional",
        start: 0,
        alternatives: [2, 4],
        end: 6,
      });
    });

    it("is case insensitive", () => {
      const { blocks: found, errors } = blocks("Foo MACRO\n nop\n ENDM\n");
      expect(errors).toHaveLength(0);
      expect(found[0]).toMatchObject({ kind: "macro", end: 2 });
    });
  });

  describe("nesting", () => {
    it("nests blocks inside one another", () => {
      const { blocks: found, errors } = blocks(
        "M macro\n ifeq 1\n rept 4\n nop\n endr\n endc\n endm\n",
      );
      expect(errors).toHaveLength(0);
      expect(found).toHaveLength(1);

      const macro = found[0];
      expect(macro).toMatchObject({ kind: "macro", start: 0, end: 6 });
      expect(macro.children).toHaveLength(1);

      const conditional = macro.children[0];
      expect(conditional).toMatchObject({
        kind: "conditional",
        start: 1,
        end: 5,
      });
      expect(conditional.children[0]).toMatchObject({
        kind: "repeat",
        start: 2,
        end: 4,
      });
    });

    it("keeps sibling blocks separate", () => {
      const { blocks: found } = blocks("A macro\n endm\nB macro\n endm\n");
      expect(found.map((b) => b.name)).toEqual(["A", "B"]);
    });
  });

  describe("malformed input", () => {
    it("reports a block that is never closed", () => {
      const { blocks: found, errors } = blocks("M macro\n nop\n");
      expect(found[0]).toMatchObject({ kind: "macro", start: 0 });
      expect(found[0].end).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe("UNTERMINATED_BLOCK");
      expect(errors[0].loc.line).toBe(1);
    });

    it("reports a terminator that closes nothing", () => {
      const { errors } = blocks(" nop\n endm\n");
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe("UNEXPECTED_BLOCK_TERMINATOR");
      expect(errors[0].loc.line).toBe(2);
    });

    it("reports an else outside a conditional", () => {
      const { errors } = blocks(" nop\n else\n");
      expect(errors[0].code).toBe("UNEXPECTED_BLOCK_TERMINATOR");
    });

    it("closes the outer block when nesting crosses", () => {
      // `endm` cannot close the conditional, so the conditional is left
      // unterminated and the macro closes.
      const { blocks: found, errors } = blocks("M macro\n ifeq 1\n endm\n");
      expect(found[0]).toMatchObject({ kind: "macro", end: 2 });
      expect(found[0].children[0].end).toBeUndefined();
      expect(errors.map((e) => e.code)).toEqual(["UNTERMINATED_BLOCK"]);
    });

    it("keeps going after an unmatched terminator", () => {
      const { blocks: found } = blocks(" endc\nM macro\n endm\n");
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ kind: "macro", start: 1, end: 2 });
    });

    it("returns nothing for a file with no blocks", () => {
      const { blocks: found, errors } = blocks(" move d0,d1\n rts\n");
      expect(found).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it("does not carry the internal bookkeeping into the result", () => {
      const [block] = blocks("M macro\n endm\n").blocks;
      expect(block).not.toHaveProperty("closers");
      expect(block).not.toHaveProperty("opener");
    });
  });

  describe("lookup", () => {
    const structure = blocks("M macro\n ifeq 1\n nop\n endc\n endm\n nop\n");

    it("finds the innermost block at a line", () => {
      expect(blockAt(structure, 2)).toMatchObject({ kind: "conditional" });
    });

    it("finds the enclosing chain, outermost first", () => {
      expect(enclosingBlocks(structure, 2).map((b) => b.kind)).toEqual([
        "macro",
        "conditional",
      ]);
    });

    it("includes the opening and closing lines", () => {
      expect(blockAt(structure, 0)).toMatchObject({ kind: "macro" });
      expect(blockAt(structure, 4)).toMatchObject({ kind: "macro" });
    });

    it("returns nothing outside any block", () => {
      expect(blockAt(structure, 5)).toBeUndefined();
      expect(enclosingBlocks(structure, 5)).toEqual([]);
    });

    it("treats an unterminated block as running to the end of the file", () => {
      const open = blocks("M macro\n nop\n nop\n");
      expect(blockAt(open, 2)).toMatchObject({ kind: "macro" });
    });
  });

  describe("blockRole", () => {
    const roleOf = (src: string) => blockRole(parseLine(src).value);

    it("classifies openers", () => {
      expect(roleOf("M macro")).toBe("opener");
      expect(roleOf(" rept 4")).toBe("opener");
      expect(roleOf(" ifeq 1")).toBe("opener");
      expect(roleOf(" ifnd FOO")).toBe("opener");
    });

    it("classifies alternatives", () => {
      expect(roleOf(" else")).toBe("alternative");
      expect(roleOf(" elseif 2")).toBe("alternative");
    });

    it("classifies terminators", () => {
      expect(roleOf(" endm")).toBe("terminator");
      expect(roleOf(" endr")).toBe("terminator");
      expect(roleOf(" endc")).toBe("terminator");
      expect(roleOf(" endif")).toBe("terminator");
    });

    it("returns nothing for a line that is not block structure", () => {
      expect(roleOf(" move.w d0,d1")).toBeUndefined();
      expect(roleOf("Label:")).toBeUndefined();
      expect(roleOf(" dc.w 1")).toBeUndefined();
      expect(roleOf("")).toBeUndefined();
      expect(blockRole(undefined)).toBeUndefined();
    });
  });
});
