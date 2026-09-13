import { parseLine } from "../index.js";
import type { MemoryIndirectNode } from "../index.js";

describe("parse", () => {
  describe("#parseLine()", () => {
    it("parses a complete instruction line", () => {
      const line = parseLine(
        "label:    move.w     #1,10(a0,d1,w)    ; comment here",
      ).value;
      expect(line.label).toMatchObject({
        loc: { start: 0, end: 5 },
        label: "label",
      });
      expect(line.mnemonic).toMatchObject({
        loc: { start: 10, end: 14 },
        type: "instruction",
        instruction: "move",
      });
      expect(line.qualifier).toMatchObject({
        loc: { start: 15, end: 16 },
        size: "w",
      });
      expect(line.operands).toHaveLength(2);
      expect(line.operands?.[0]).toMatchObject({ loc: { start: 21, end: 23 } });
      expect(line.operands?.[1]).toMatchObject({ loc: { start: 24, end: 35 } });
      expect(line.comment).toMatchObject({ loc: { start: 39, end: 53 } });
    });

    it("parses an instruction line with no size", () => {
      const line = parseLine("label: move #1,10(a0,d1,w) ; comment here").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
        mnemonic: {
          loc: { start: 7, end: 11 },
          type: "instruction",
          instruction: "move",
        },
        operands: [
          { loc: { start: 12, end: 14 } },
          { loc: { start: 15, end: 26 } },
        ],
        comment: { loc: { start: 27, end: 41 }, content: "comment here" },
      });
    });

    it("parses a line with only a label", () => {
      const line = parseLine("label:").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
      });
    });

    it("parses a label with no colon", () => {
      const line = parseLine("label").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
      });
    });

    it("parses a label with double colon (external)", () => {
      const line = parseLine("label::").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label", scope: "external" },
      });
    });

    it("parses a local label", () => {
      const line = parseLine(".label:").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 6 }, label: ".label", scope: "local" },
      });
    });

    it("parses a local label with alternate syntax", () => {
      const line = parseLine("label$:").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 6 }, label: "label$", scope: "local" },
      });
    });

    it("parses a label with leading whitespace", () => {
      const line = parseLine("   label:").value;
      expect(line).toMatchObject({
        label: { loc: { start: 3, end: 8 }, label: "label" },
      });
    });

    it("parses a label and mnemonic with no whitespace", () => {
      const line = parseLine("label:rts").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
        mnemonic: {
          loc: { start: 6, end: 9 },
          type: "instruction",
          instruction: "rts",
        },
      });
    });

    it("parses an instruction line with no label", () => {
      const line = parseLine("     move.w #1,10(a0,d1,w) ; comment here").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 5, end: 9 },
          type: "instruction",
          instruction: "move",
        },
        qualifier: { loc: { start: 10, end: 11 }, size: "w" },
        operands: [
          { loc: { start: 12, end: 14 } },
          { loc: { start: 15, end: 26 } },
        ],
        comment: { loc: { start: 27, end: 41 }, content: "comment here" },
      });
    });

    it("parses an instruction line with no operands", () => {
      const line = parseLine("     bra.s ; comment here").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 5, end: 8 },
          type: "instruction",
          instruction: "bra",
        },
        qualifier: { loc: { start: 9, end: 10 }, size: "s" },
        comment: { loc: { start: 11, end: 25 }, content: "comment here" },
      });
    });

    it("parses a comment by position", () => {
      const line = parseLine("label: move #1,10(a0,d1.w) comment here").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
        mnemonic: {
          loc: { start: 7, end: 11 },
          type: "instruction",
          instruction: "move",
        },
        operands: [
          { loc: { start: 12, end: 14 } },
          { loc: { start: 15, end: 26 } },
        ],
        comment: { loc: { start: 27, end: 39 } },
      });
    });

    it("parses a comment by position for instructions with no operands", () => {
      const line = parseLine(" rts comment here").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 4 },
          type: "instruction",
          instruction: "rts",
        },
        comment: { loc: { start: 5, end: 17 } },
      });
    });

    it("parses a comment by separator for macros with no operands", () => {
      const line = parseLine(" mcr ; comment here").value;
      expect(line).toMatchObject({
        mnemonic: { loc: { start: 1, end: 4 }, type: "macro", macro: "mcr" },
        comment: { loc: { start: 5, end: 19 }, content: "comment here" },
      });
    });

    it("parses operands with space after comma", () => {
      const line = parseLine(
        "label:    move.w     #1, 10(a0,d1,w)    ; comment here",
      ).value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
        mnemonic: {
          loc: { start: 10, end: 14 },
          type: "instruction",
          instruction: "move",
        },
        qualifier: { loc: { start: 15, end: 16 }, size: "w" },
        operands: [
          { loc: { start: 21, end: 23 } },
          { loc: { start: 25, end: 36 } },
        ],
        comment: { loc: { start: 40, end: 54 }, content: "comment here" },
      });
    });

    it("parses an empty line", () => {
      const line = parseLine("").value;
      expect(line).toMatchObject({});
    });

    it("parses a line with only whitespace", () => {
      const line = parseLine("  ").value;
      expect(line).toMatchObject({});
    });

    it("parses '=' as a mnemonic", () => {
      const line = parseLine("label = value").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
        mnemonic: {
          loc: { start: 6, end: 7 },
          type: "directive",
          directive: "=",
        },
        operands: [{ loc: { start: 8, end: 13 } }],
      });
    });

    it("parses '=' as a mnemonic with no whitespace", () => {
      const line = parseLine("label=value").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
        mnemonic: {
          loc: { start: 5, end: 6 },
          type: "directive",
          directive: "=",
        },
        operands: [{ loc: { start: 6, end: 11 } }],
      });
    });

    it("parses an incomplete size", () => {
      const line = parseLine("label:    move.").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 5 }, label: "label" },
        mnemonic: {
          loc: { start: 10, end: 14 },
          type: "instruction",
          instruction: "move",
        },
      });
      // A dot with nothing after it is reported as an empty unknown qualifier,
      // so a caller can tell a size is being typed there.
      expect(line.qualifier).toEqual({
        type: "unknown",
        loc: { start: 15, end: 15, line: undefined },
      });
    });

    it("parses an unrecognised size", () => {
      const line = parseLine("label:    move.z d0,d1").value;
      expect(line.qualifier).toMatchObject({
        type: "unknown",
        loc: { start: 15, end: 16 },
      });
      // The rest of the line still parses.
      expect(line.operands).toHaveLength(2);
    });

    it("parses an incomplete operand list", () => {
      const line = parseLine(" move d0,").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 5 },
          type: "instruction",
          instruction: "move",
        },
        operands: [
          { loc: { start: 6, end: 8 } },
          { loc: { start: 9, end: 9 } },
        ],
      });
    });

    it("parses an operand containing spaces in double quotes", () => {
      const line = parseLine(' dc.b "foo bar baz" ; comment').value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 3 },
          type: "directive",
          directive: "dc",
        },
        qualifier: { loc: { start: 4, end: 5 }, size: "b" },
        operands: [{ loc: { start: 6, end: 19 } }],
        comment: {
          loc: { start: 20, end: 29 },
        },
      });
    });

    it("parses an operand containing spaces with in single quotes", () => {
      const line = parseLine(" dc.b 'foo bar baz' ; comment").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 3 },
          type: "directive",
          directive: "dc",
        },
        qualifier: { loc: { start: 4, end: 5 }, size: "b" },
        operands: [{ loc: { start: 6, end: 19 } }],
        comment: {
          loc: { start: 20, end: 29 },
        },
      });
    });

    it("parses an operand containing spaces with unbalanced quotes", () => {
      const line = parseLine(" dc.b 'foo bar baz").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 3 },
          type: "directive",
          directive: "dc",
        },
        qualifier: { loc: { start: 4, end: 5 }, size: "b" },
        operands: [{ loc: { start: 6, end: 18 } }],
      });
    });

    it("parses a label containing a numeric macro parameter", () => {
      const line = parseLine("foo\\1bar: rts").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 8 }, label: "foo\\1bar" },
        mnemonic: {
          loc: { start: 10, end: 13 },
          type: "instruction",
          instruction: "rts",
        },
      });
    });

    it("parses a label containing a special char macro parameter", () => {
      const line = parseLine("foo\\@bar: rts").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 8 }, label: "foo\\@bar" },
        mnemonic: {
          loc: { start: 10, end: 13 },
          type: "instruction",
          instruction: "rts",
        },
      });
    });

    it("parses a label containing a quoted macro parameter", () => {
      const line = parseLine("foo\\<reptn>bar: rts").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 14 }, label: "foo\\<reptn>bar" },
        mnemonic: {
          loc: { start: 16, end: 19 },
          type: "instruction",
          instruction: "rts",
        },
      });
    });

    it("parses a mnemonic containing a macro parameter", () => {
      const line = parseLine(" b\\1 d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: { loc: { start: 1, end: 4 }, type: "macro", macro: "b\\1" },
        operands: [
          { loc: { start: 5, end: 7 } },
          { loc: { start: 8, end: 10 } },
        ],
      });
    });

    it("parses a numeric macro parameter as mnemonic", () => {
      const line = parseLine(" \\1.w d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 3 },
          type: "macro-parameter",
          paramType: "numeric",
          param: "1",
        },
        qualifier: { loc: { start: 4, end: 5 }, type: "size", size: "w" },
        operands: [
          { type: "data-register", register: "d0" },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses a special macro parameter as mnemonic", () => {
      const line = parseLine(" \\@.l d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 3 },
          type: "macro-parameter",
          paramType: "special",
          param: "@",
        },
        qualifier: { loc: { start: 4, end: 5 }, type: "size", size: "l" },
      });
    });

    it("parses a named macro parameter as mnemonic", () => {
      const line = parseLine(" \\<inst> d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 8 },
          type: "macro-parameter",
          paramType: "named",
          param: "<inst>",
        },
      });
    });

    it("parses a numeric macro parameter as qualifier", () => {
      const line = parseLine(" move.\\1 d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 5 },
          type: "instruction",
          instruction: "move",
        },
        qualifier: {
          loc: { start: 6, end: 8 },
          type: "macro-parameter",
          paramType: "numeric",
          param: "1",
        },
        operands: [
          { loc: { start: 9, end: 11 } },
          { loc: { start: 12, end: 14 } },
        ],
      });
    });

    it("parses a special macro parameter as qualifier", () => {
      const line = parseLine(" move.\\@ d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 5 },
          type: "instruction",
          instruction: "move",
        },
        qualifier: {
          type: "macro-parameter",
          paramType: "special",
          param: "@",
        },
      });
    });

    it("parses a named macro parameter as qualifier", () => {
      const line = parseLine(" move.\\<size> d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 5 },
          type: "instruction",
          instruction: "move",
        },
        qualifier: {
          type: "macro-parameter",
          paramType: "named",
          param: "<size>",
        },
      });
    });

    it("parses letter macro parameters (\\a-\\z) as mnemonic", () => {
      const line = parseLine(" \\k.w d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "letter",
          param: "k",
        },
        qualifier: { type: "size", size: "w" },
      });
    });

    it("parses letter macro parameters as qualifier", () => {
      const line = parseLine(" move.\\z d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: { type: "instruction", instruction: "move" },
        qualifier: {
          type: "macro-parameter",
          paramType: "letter",
          param: "z",
        },
      });
    });

    it("parses query macro parameter (\\?n) as mnemonic", () => {
      const line = parseLine(" \\?1 d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "query",
          param: "1",
        },
      });
    });

    it("parses query macro parameter (\\?a) with letter", () => {
      const line = parseLine(" \\?k d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "query",
          param: "k",
        },
      });
    });

    it("parses CARG current operator (\\.) as mnemonic", () => {
      const line = parseLine(" \\. d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "carg",
          param: ".",
        },
        operands: [
          { type: "data-register", register: "d0" },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses CARG increment operator (\\+) as mnemonic", () => {
      const line = parseLine(" \\+ d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "carg",
          param: "+",
        },
        operands: [
          { type: "data-register", register: "d0" },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses CARG decrement operator (\\-) as mnemonic", () => {
      const line = parseLine(" \\- d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "carg",
          param: "-",
        },
        operands: [
          { type: "data-register", register: "d0" },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses an operand containing a macro parameter", () => {
      const line = parseLine(" move \\1,d0").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 1, end: 5 },
          type: "instruction",
          instruction: "move",
        },
        operands: [
          { loc: { start: 6, end: 8 } },
          { loc: { start: 9, end: 11 } },
        ],
      });
    });

    it("parses a quoted macro arguments", () => {
      const line = parseLine('    FOO     <1,"foo">,d2').value;
      expect(line).toMatchObject({
        mnemonic: { loc: { start: 4, end: 7 }, type: "macro", macro: "FOO" },
        operands: [
          { loc: { start: 12, end: 21 } },
          { loc: { start: 22, end: 24 } },
        ],
      });
    });

    it("parses a complex statement with parens", () => {
      const line = parseLine(
        " dc.w	ddfstop,(DIW_XSTRT-17+(DIW_W>>4-1)<<4)>>1&$fc-SCROLL*8",
      ).value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "directive",
          loc: { start: 1, end: 3 },
        },
        operands: [
          {
            loc: { start: 6, end: 13 },
          },
          { loc: { start: 14, end: 60 } },
        ],
        qualifier: {
          loc: { start: 4, end: 5 },
        },
      });
    });

    it("parses iif directive with simple condition", () => {
      const line = parseLine("    iif DEBUG dc.w $1234").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 4, end: 7 },
          type: "directive",
          directive: "iif",
        },
        inlineCondition: {
          type: "symbol",
          name: "DEBUG",
          loc: { start: 8, end: 13 },
        },
        operands: [
          {
            type: "value",
            loc: { start: 19, end: 24 },
            value: {
              type: "numeric-literal",
              value: 4660,
            },
          },
        ],
      });
    });

    it("parses iif directive with expression condition", () => {
      const line = parseLine("    iif REPTN==1 move.l d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 4, end: 7 },
          type: "directive",
          directive: "iif",
        },
        inlineCondition: {
          type: "binary-op",
          operator: "=",
          left: {
            type: "builtin-symbol",
            name: "REPTN",
          },
          right: {
            type: "numeric-literal",
            value: 1,
          },
        },
        operands: [
          { type: "data-register", register: "d0" },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses iif directive with label (from docs example)", () => {
      const line = parseLine("foo iif bar equ 42").value;
      expect(line).toMatchObject({
        label: { loc: { start: 0, end: 3 }, label: "foo" },
        mnemonic: {
          loc: { start: 4, end: 7 },
          type: "directive",
          directive: "iif",
        },
        inlineCondition: {
          type: "symbol",
          name: "bar",
        },
        operands: [
          {
            type: "value",
            value: {
              type: "numeric-literal",
              value: 42,
            },
          },
        ],
      });
    });

    it("parses iif directive with multiple operands in statement", () => {
      const line = parseLine("    iif MODE&1 dc.w $1234,$5678").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 4, end: 7 },
          type: "directive",
          directive: "iif",
        },
        inlineCondition: {
          type: "binary-op",
          operator: "&",
          left: {
            type: "symbol",
            name: "MODE",
          },
          right: {
            type: "numeric-literal",
            value: 1,
          },
        },
        operands: [
          {
            type: "value",
            value: {
              type: "numeric-literal",
              value: 4660,
            },
          },
          {
            type: "value",
            value: {
              type: "numeric-literal",
              value: 22136,
            },
          },
        ],
      });
    });

    it("parses ifmacrod directive", () => {
      const line = parseLine("    ifmacrod MYMACRO").value;
      expect(line).toMatchObject({
        mnemonic: {
          loc: { start: 4, end: 12 },
          type: "directive",
          directive: "ifmacrod",
        },
        operands: [
          {
            type: "value",
            value: {
              type: "symbol",
              name: "MYMACRO",
            },
          },
        ],
      });
    });

    it("parses FPU data register fp0", () => {
      const line = parseLine(" fmove.x fp0,fp1").value;
      expect(line).toMatchObject({
        mnemonic: { type: "instruction", instruction: "fmove" },
        qualifier: { type: "size", size: "x" },
        operands: [
          { type: "fpu-data-register", register: "fp0" },
          { type: "fpu-data-register", register: "fp1" },
        ],
      });
    });

    it("parses FPU control register fpcr", () => {
      const line = parseLine(" fmove.l fpcr,d0").value;
      expect(line).toMatchObject({
        mnemonic: { type: "instruction", instruction: "fmove" },
        qualifier: { type: "size", size: "l" },
        operands: [
          { type: "fpu-control-register", register: "fpcr" },
          { type: "data-register", register: "d0" },
        ],
      });
    });

    it("parses FPU register list", () => {
      const line = parseLine(" fmovem.x fp0-fp7,-(sp)").value;
      expect(line).toMatchObject({
        mnemonic: { type: "instruction", instruction: "fmovem" },
        qualifier: { type: "size", size: "x" },
        operands: [
          {
            type: "fpu-register-list",
            raw: ["fp0-fp7"],
            registers: ["fp0", "fp1", "fp2", "fp3", "fp4", "fp5", "fp6", "fp7"],
          },
          {
            type: "address-register-indirect-predec",
            register: {
              type: "address-register",
              register: "sp",
            },
          },
        ],
      });
    });

    it("parses FPU register list with multiple ranges", () => {
      const line = parseLine(" fmovem.x fp0-fp3/fp5-fp7,(a0)").value;
      expect(line).toMatchObject({
        mnemonic: { type: "instruction", instruction: "fmovem" },
        operands: [
          {
            type: "fpu-register-list",
            raw: ["fp0-fp3", "fp5-fp7"],
            registers: ["fp0", "fp1", "fp2", "fp3", "fp5", "fp6", "fp7"],
          },
          {
            type: "address-register-indirect",
            register: {
              type: "address-register",
              register: "a0",
            },
          },
        ],
      });
    });

    it("parses indexed addressing with scale factor *2", () => {
      const line = parseLine(" move.l (a0,d1.w*2),d0").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "address-register-indirect-index",
            baseRegister: {
              type: "address-register",
              register: "a0",
            },
            indexRegister: {
              type: "data-register",
              register: "d1",
            },
            indexSize: {
              type: "size",
              size: "w",
            },
            scaleFactor: {
              type: "numeric-literal",
              value: 2,
            },
          },
          { type: "data-register", register: "d0" },
        ],
      });
    });

    it("parses indexed addressing with scale factor *4", () => {
      const line = parseLine(" move.l 10(a0,d1.l*4),d0").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "address-register-indirect-index",
            baseRegister: {
              type: "address-register",
              register: "a0",
            },
            indexRegister: {
              type: "data-register",
              register: "d1",
            },
            indexSize: {
              type: "size",
              size: "l",
            },
            scaleFactor: {
              type: "numeric-literal",
              value: 4,
            },
            displacement: {
              type: "numeric-literal",
              value: 10,
            },
          },
          {
            type: "data-register",
            register: "d0",
          },
        ],
      });
    });

    it("parses PC relative with scale factor", () => {
      const line = parseLine(" move.l table(pc,d0.w*2),d1").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "pc-relative-index",
            indexRegister: {
              type: "data-register",
              register: "d0",
            },
            indexSize: {
              type: "size",
              size: "w",
            },
            scaleFactor: {
              type: "numeric-literal",
              value: 2,
            },
            displacement: {
              type: "symbol",
              name: "table",
            },
          },
          {
            type: "data-register",
            register: "d1",
          },
        ],
      });
    });

    it("parses indexed addressing with macro parameter as base register", () => {
      const line = parseLine(" move.w #1,label(\\1,a2.w)").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "immediate",
          },
          {
            type: "address-register-indirect-index",
            displacement: {
              type: "symbol",
              name: "label",
            },
            baseRegister: {
              type: "macro-parameter",
              paramType: "numeric",
              param: "1",
            },
            indexRegister: {
              type: "address-register",
              register: "a2",
            },
            indexSize: {
              type: "size",
              size: "w",
            },
          },
        ],
      });
    });

    it("parses indexed addressing with expression scale factor", () => {
      const line = parseLine(" move.l 38(a0,d0.w*(foo+1)),d1").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "address-register-indirect-index",
            displacement: {
              type: "numeric-literal",
              value: 38,
            },
            baseRegister: {
              type: "address-register",
              register: "a0",
            },
            indexRegister: {
              type: "data-register",
              register: "d0",
            },
            indexSize: {
              type: "size",
              size: "w",
            },
            scaleFactor: {
              type: "group",
              expression: {
                type: "binary-op",
                operator: "+",
                left: {
                  type: "symbol",
                  name: "foo",
                },
                right: {
                  type: "numeric-literal",
                  value: 1,
                },
              },
            },
          },
          {
            type: "data-register",
            register: "d1",
          },
        ],
      });
    });

    it("reports errors for invalid scale factor", () => {
      const line = parseLine(" move.w label(a0,d0*3),d1");
      expect(line.errors).toHaveLength(1);
      expect(line.errors?.[0].code).toBe("INVALID_SCALE_FACTOR");
    });

    it("parses bitfield with offset and width", () => {
      const line = parseLine(" bfchg {0:5},d0").value;
      expect(line).toMatchObject({
        mnemonic: { type: "instruction", instruction: "bfchg" },
        operands: [
          {
            type: "bitfield",
            offset: {
              type: "numeric-literal",
              value: 0,
            },
            width: {
              type: "numeric-literal",
              value: 5,
            },
          },
          { type: "data-register", register: "d0" },
        ],
      });
    });

    it("parses bitfield with just offset", () => {
      const line = parseLine(" bftst {10},d1").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "bitfield",
            offset: {
              type: "numeric-literal",
              value: 10,
            },
          },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses bitfield with register offset and width", () => {
      const line = parseLine(" bfexts {d0:d1},(a0)").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "bitfield",
            offset: {
              type: "data-register",
              register: "d0",
            },
            width: {
              type: "data-register",
              register: "d1",
            },
          },
          {
            type: "address-register-indirect",
            register: {
              type: "address-register",
              register: "a0",
            },
          },
        ],
      });
    });

    it("parses a bitfield applied to a data register", () => {
      const line = parseLine(" bfextu d0{4:8},d1");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands).toMatchObject([
        {
          type: "bitfield",
          base: { type: "data-register", register: "d0" },
          offset: { type: "numeric-literal", value: 4 },
          width: { type: "numeric-literal", value: 8 },
        },
        { type: "data-register", register: "d1" },
      ]);
    });

    it("parses a bitfield with register offset and width", () => {
      const line = parseLine(" bfins d1,d0{d2:d3}");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[1]).toMatchObject({
        type: "bitfield",
        base: { type: "data-register", register: "d0" },
        offset: { type: "data-register", register: "d2" },
        width: { type: "data-register", register: "d3" },
      });
    });

    it("parses a bitfield applied to an absolute address", () => {
      const line = parseLine(" bfclr $dff180{0:8}");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "bitfield",
        base: {
          type: "absolute-address",
          address: { type: "numeric-literal", value: 0xdff180 },
        },
        offset: { type: "numeric-literal", value: 0 },
        width: { type: "numeric-literal", value: 8 },
      });
    });

    it("parses a bitfield applied to an indirect with displacement", () => {
      const line = parseLine(" bfffo 12(a0){d0:4},d1");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "bitfield",
        base: {
          type: "address-register-indirect-displacement",
          register: { type: "address-register", register: "a0" },
        },
        offset: { type: "data-register", register: "d0" },
      });
    });

    it("parses a register pair for 64-bit multiply", () => {
      const line = parseLine(" mulu.l d0,d1:d2");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands).toMatchObject([
        { type: "data-register", register: "d0" },
        {
          type: "register-pair",
          first: { type: "data-register", register: "d1" },
          second: { type: "data-register", register: "d2" },
        },
      ]);
    });

    it("parses a register pair for divsl.l", () => {
      const line = parseLine(" divsl.l d0,d1:d2");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[1]).toMatchObject({
        type: "register-pair",
        first: { type: "data-register", register: "d1" },
        second: { type: "data-register", register: "d2" },
      });
    });

    it("parses cas2 with register and indirect pairs", () => {
      const line = parseLine(" cas2.w d0:d1,d2:d3,(a0):(a1)");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands).toHaveLength(3);
      expect(line.value.operands?.[2]).toMatchObject({
        type: "register-pair",
        first: {
          type: "address-register-indirect",
          register: { type: "address-register", register: "a0" },
        },
        second: {
          type: "address-register-indirect",
          register: { type: "address-register", register: "a1" },
        },
      });
    });

    it("does not treat a colon in a path-like operand as a register pair", () => {
      // df0:file.i is not d-something : d-something
      const line = parseLine(" MyMacro df0:file.i");
      expect(line.value.operands?.[0].type).not.toBe("register-pair");
    });

    it("parses memory indirect postindexed", () => {
      const line = parseLine(" move.l ([a0],d0.l,12),d1");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "memory-indirect",
        baseRegister: { type: "address-register", register: "a0" },
        indexRegister: { type: "data-register", register: "d0" },
        indexSize: { type: "size", size: "l" },
        outerDisplacement: { type: "numeric-literal", value: 12 },
        indexPosition: "post",
      });
    });

    it("marks an index inside the brackets as preindexed", () => {
      const line = parseLine(" move.l ([8,a0,d0.l*4],4),d1");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "memory-indirect",
        indexRegister: { type: "data-register", register: "d0" },
        indexPosition: "pre",
      });
    });

    it("treats a non-register after the brackets as the outer displacement", () => {
      const line = parseLine(" move.l ([a0],4),d1");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "memory-indirect",
        outerDisplacement: { type: "numeric-literal", value: 4 },
      });
      expect(
        (line.value.operands?.[0] as MemoryIndirectNode).indexPosition,
      ).toBeUndefined();
    });

    it("reports a memory indirect with both a pre- and a postindex", () => {
      const line = parseLine(" move.l ([a0,a1],d2.w,8),d3");
      expect(line.errors?.[0].code).toBe("MALFORMED_MEMORY_INDIRECT");
    });

    it("parses memory indirect with base register and outer displacement", () => {
      const line = parseLine(" move.l ([a0],4),d0").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "memory-indirect",
            baseRegister: {
              type: "address-register",
              register: "a0",
            },
            outerDisplacement: {
              type: "numeric-literal",
              value: 4,
            },
          },
          { type: "data-register", register: "d0" },
        ],
      });
    });

    it("parses memory indirect with base displacement and register", () => {
      const line = parseLine(" move.l ([8,a1]),d0").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "memory-indirect",
            baseDisplacement: {
              type: "numeric-literal",
              value: 8,
            },
            baseRegister: {
              type: "address-register",
              register: "a1",
            },
          },
          { type: "data-register", register: "d0" },
        ],
      });
    });

    it("parses memory indirect with index register", () => {
      const line = parseLine(" move.l ([a0,d1.w]),d0").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "memory-indirect",
            baseRegister: {
              type: "address-register",
              register: "a0",
            },
            indexRegister: {
              type: "data-register",
              register: "d1",
            },
            indexSize: {
              type: "size",
              size: "w",
            },
          },
          { type: "data-register", register: "d0" },
        ],
      });
    });

    it("parses memory indirect with full syntax", () => {
      const line = parseLine(" move.l ([16,a2,d3.l*4],32),d0").value;
      expect(line).toMatchObject({
        operands: [
          {
            type: "memory-indirect",
            baseDisplacement: {
              type: "numeric-literal",
              value: 16,
            },
            baseRegister: {
              type: "address-register",
              register: "a2",
            },
            indexRegister: {
              type: "data-register",
              register: "d3",
            },
            indexSize: {
              type: "size",
              size: "l",
            },
            scaleFactor: {
              type: "numeric-literal",
              value: 4,
            },
            outerDisplacement: {
              type: "numeric-literal",
              value: 32,
            },
          },
          { type: "data-register", register: "d0" },
        ],
      });
    });

    it("collects multiple errors when operands have issues", () => {
      const line = parseLine(" move.w label(a0,d0*3),label2(a1,d1*9)");
      expect(line.errors?.length).toBe(2);
      expect(line.errors?.[0].code).toBe("INVALID_SCALE_FACTOR");
      expect(line.errors?.[1].code).toBe("INVALID_SCALE_FACTOR");
    });

    it("reports error for unclosed parenthesis", () => {
      const line = parseLine(" move.w .label(a1");
      expect(line.value.operands?.[0].type).toBe("unknown");
      expect(line.errors).toBeDefined();
      expect(line.errors?.[0].code).toBe("UNCLOSED_PAREN");
    });

    it("reports error for unclosed bracket", () => {
      const line = parseLine(" move.l ([a0,d0.l");
      expect(line.errors).toBeDefined();
      expect(line.errors?.[0].code).toBe("UNCLOSED_BRACKET");
    });

    it("reports error for unclosed parenthesis in expression", () => {
      const line = parseLine(" move.w #(1+2");
      expect(line.errors).toBeDefined();
      expect(line.errors?.[0].code).toBe("UNCLOSED_PAREN");
    });

    it("reports error for unclosed paren in iif condition", () => {
      const line = parseLine(" iif (cond move.w d0,d1");
      expect(line.errors).toBeDefined();
      expect(line.errors?.some((e) => e.code === "UNCLOSED_PAREN")).toBe(true);
    });

    it("parses packed decimal size qualifier .p", () => {
      const line = parseLine(" dc.p #1.5").value;
      expect(line).toMatchObject({
        mnemonic: { type: "directive", directive: "dc" },
        qualifier: { type: "size", size: "p" },
      });
    });

    it("parses quad size qualifier .q", () => {
      const line = parseLine(" dc.q $0123456789abcdef").value;
      expect(line).toMatchObject({
        mnemonic: { type: "directive", directive: "dc" },
        qualifier: { type: "size", size: "q" },
      });
    });

    it("parses extended macro parameter \\@! (unique-push)", () => {
      const line = parseLine(" \\@! d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "unique-push",
          param: "@!",
        },
        operands: [
          { type: "data-register", register: "d0" },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses extended macro parameter \\@? (unique-push-below)", () => {
      const line = parseLine(" \\@? d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "unique-push-below",
          param: "@?",
        },
      });
    });

    it("parses extended macro parameter \\@@ (unique-pull)", () => {
      const line = parseLine(" \\@@ d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "unique-pull",
          param: "@@",
        },
      });
    });

    it("parses \\@! with size qualifier", () => {
      const line = parseLine(" \\@!.w d0,d1").value;
      expect(line).toMatchObject({
        mnemonic: {
          type: "macro-parameter",
          paramType: "unique-push",
          param: "@!",
        },
        qualifier: { type: "size", size: "w" },
      });
    });
  });

  describe("Silent Error Detection", () => {
    it("reports error for missing scale factor after *", () => {
      const line = parseLine(" move.w label(a1,d0.w*),d0");
      expect(line.errors).toBeDefined();
      expect(line.errors?.[0].code).toBe("MISSING_SCALE_FACTOR");
      expect(line.errors?.[0].message).toContain(
        "Missing scale factor after '*'",
      );
    });

    it("reports error for malformed hex number in expression ($ without digits)", () => {
      const line = parseLine(" move.w #$,d0");
      expect(line.errors).toBeDefined();
      // Tokenizer reports $ as unknown character when not followed by hex digits
      expect(line.errors?.[0].code).toBe("UNKNOWN_CHARACTER");
      expect(line.errors?.[0].got).toBe("$");
    });

    it("reports error for malformed binary number in expression (% without digits)", () => {
      const line = parseLine(" move.w #%,d0");
      expect(line.errors).toBeDefined();
      // % is binary XOR operator in expressions, so this should parse
      // Actually no error here - % is a valid operator
      // Let's check with just % by itself which would be unexpected
      expect(line.errors).toBeDefined();
      expect(line.errors?.[0].code).toBe("INVALID_EXPRESSION");
    });

    it("reports error for unknown character in expression", () => {
      const line = parseLine(" move.w #5`3,d0");
      expect(line.errors).toBeDefined();
      // A backtick is not valid anywhere in an expression
      expect(line.errors?.[0].code).toBe("UNKNOWN_CHARACTER");
    });

    it("reports a lone at-sign, which is not a valid identifier", () => {
      // `@` starts an identifier in vasm's mot syntax, but ISBADID rejects it
      // on its own, and it is only an octal prefix before an octal digit.
      const line = parseLine(" move.w #@,d0");
      expect(line.errors?.[0].code).toBe("UNKNOWN_CHARACTER");
    });

    it("reports missing scale factor error", () => {
      const line = parseLine(" move.w label(a1,d0.w*),d0");
      expect(line.errors).not.toHaveLength(0);
      expect(line.errors?.[0].code).toBe("MISSING_SCALE_FACTOR");
    });

    it("accepts macro parameters in index register position", () => {
      const line = parseLine(" move.w d0,(a0,\\1)").value;
      expect(line.operands).toBeDefined();
      expect(line.operands?.length).toBe(2);
      expect(line.operands?.[1].type).toBe("address-register-indirect-index");
      if (line.operands?.[1].type === "address-register-indirect-index") {
        expect(line.operands[1].indexRegister.type).toBe("macro-parameter");
      }
    });

    it("accepts macro parameters with size in index position", () => {
      const line = parseLine(" move.w d0,(a0,\\1.w)").value;
      expect(line.operands).toBeDefined();
      expect(line.operands?.length).toBe(2);
      expect(line.operands?.[1].type).toBe("address-register-indirect-index");
      if (line.operands?.[1].type === "address-register-indirect-index") {
        expect(line.operands[1].indexRegister.type).toBe("macro-parameter");
        expect(line.operands[1].indexSize?.type).toBe("size");
      }
    });

    it("rejects data registers as base registers in indexed addressing", () => {
      const line = parseLine(" move.w (d0,a1.w),d1");
      expect(line.errors).toBeDefined();
      expect(line.errors?.[0].code).toBe("INVALID_BASE_REGISTER");
      expect(line.errors?.[0].message).toContain("d0");
    });

    it("reports error for invalid expression with addressing mode syntax", () => {
      const line = parseLine(" move.w #1,l+(a1,d0.w)");
      expect(line.errors).toBeDefined();
      // The operand l+(a1,d0.w) is parsed as indexed addressing: l+ is the
      // displacement, (a1,d0.w) is the indexed part. The displacement l+ is an
      // incomplete binary operation (missing right operand after +)
      expect(line.errors?.[0].code).toBe("INVALID_EXPRESSION");
      expect(line.errors?.[0].message).toContain("Unexpected token 'eof'");
    });

    it("reports error for immediate value with parentheses and comma", () => {
      const line = parseLine(" move.w #l+(a1,d0.w),d0");
      expect(line.errors).toBeDefined();
      // #l+(a1,d0.w) is parsed as an immediate expression. The comma is invalid in expressions
      expect(line.errors?.[0].code).toBe("UNKNOWN_CHARACTER");
      expect(line.errors?.[0].got).toBe(",");
    });

    it("treats a C style comment as a comment, not division", () => {
      // The NDK headers document constants this way. Motorola syntax ends the
      // operand field at whitespace, so the whole `/* ... */` is a comment.
      const line = parseLine("ASHIFTSHIFT = 12        /* bits to align */");
      expect(line.errors).toHaveLength(0);
      expect(line.value.comment?.content).toBe("/* bits to align */");
      expect(line.value.operands).toHaveLength(1);
    });

    it("keeps division parsing when the asterisk is absent", () => {
      const spaced = parseLine(" dc.w 12 / 4").value;
      expect(spaced.comment).toBeUndefined();
      expect(spaced.operands).toHaveLength(1);

      const tight = parseLine(" dc.w 12/4").value;
      expect(tight.comment).toBeUndefined();
      expect(tight.operands).toHaveLength(1);
    });
  });
});
