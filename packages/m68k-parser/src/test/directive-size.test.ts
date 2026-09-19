import { parseLine } from "../line-parser.js";
import { directiveSize } from "../directive-size.js";

const size = (text: string, options?: Parameters<typeof directiveSize>[1]) =>
  directiveSize(parseLine(`\t${text}`).value, options);

describe("directiveSize", () => {
  describe("dc", () => {
    it("counts elements at the size given", () => {
      expect(size("dc.b 1,2,3")).toBe(3);
      expect(size("dc.w 1,2,3")).toBe(6);
      expect(size("dc.l 1,2")).toBe(8);
      expect(size("dc.s 1.0")).toBe(4);
      expect(size("dc.d 1.0")).toBe(8);
      expect(size("dc.x 1.0")).toBe(12);
    });

    it("takes a word when no size is given", () => {
      expect(size("dc 1,2,3")).toBe(6);
    });

    it("counts each character of a string in bytes, one element in anything wider", () => {
      expect(size("dc.b 'abc'")).toBe(3);
      expect(size('dc.b "abc",0')).toBe(4);
      // vasm: dc.w "ab" is the single word $6162, and dc.l "abcd" one long.
      expect(size("dc.w 'ab'")).toBe(2);
      expect(size('dc.l "abcd"')).toBe(4);
      expect(size('dc.w "a","b"')).toBe(4);
      expect(size('dc.l "ab",1')).toBe(8);
    });

    it("is zero with no operands", () => {
      expect(size("dc.b")).toBe(0);
    });

    it("counts a backslash as the character it is", () => {
      expect(size('dc.b "a\\n"')).toBe(3);
    });

    it("has the same directives under their other names", () => {
      expect(size("db 1,2")).toBe(2);
      expect(size("dw 1,2")).toBe(4);
      expect(size("dl 1,2")).toBe(8);
    });
  });

  describe("dcb, ds and blk", () => {
    it("multiply the count by the size", () => {
      expect(size("dcb.b 5,0")).toBe(5);
      expect(size("ds.w 4")).toBe(8);
      expect(size("ds.l 3")).toBe(12);
      expect(size("blk.b 7")).toBe(7);
    });

    it("take a word when no size is given", () => {
      expect(size("ds 4")).toBe(8);
      expect(size("dcb 3,0")).toBe(6);
    });

    it("allow a count of zero", () => {
      expect(size("ds.b 0")).toBe(0);
    });

    it("evaluate an expression of literals", () => {
      expect(size("ds.b 2*3+1")).toBe(7);
    });

    it("are unknown for a count that is not known", () => {
      expect(size("ds.b count")).toBeUndefined();
    });

    it("use the evaluator for a name it knows", () => {
      const evaluate = (expr: { type: string; name?: string }) =>
        expr.type === "symbol" && expr.name === "count" ? 16 : undefined;
      expect(size("ds.b count", { evaluate })).toBe(16);
    });

    it("are unknown for a count below zero", () => {
      expect(size("ds.b -1")).toBeUndefined();
    });
  });

  it("is undefined for any other directive", () => {
    for (const text of ["equ 4", "even", "section code,code", "xdef foo"])
      expect(size(text)).toBeUndefined();
  });

  it("is undefined for an instruction", () => {
    expect(size("move.l d0,d1")).toBeUndefined();
  });
});

describe("quoted strings", () => {
  // Expected sizes and values are what vasm assembles for the same lines.
  it("counts a doubled quote inside a string as one character", () => {
    expect(size('dc.b "a""b"')).toBe(3);
    expect(size("dc.b 'it''s'")).toBe(4);
  });

  it("reads a string followed by an operator as an expression", () => {
    // vasm: dc.b "a"+1 is the single byte 'b'.
    expect(size('dc.b "a"+1')).toBe(1);
    expect(size("dc.b 'A'+1,0")).toBe(2);
    expect(size("ds.b 'A'+1")).toBe(66);
  });

  it("still takes a string with no closing quote as one", () => {
    expect(size('dc.b "abc')).toBe(3);
  });
});
