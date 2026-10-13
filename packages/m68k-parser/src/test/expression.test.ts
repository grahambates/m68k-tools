import { parseLine } from "../index.js";

describe("Expression Parsing", () => {
  describe("Arithmetic operators", () => {
    it("parses addition", () => {
      const line = parseLine("  dc.w label+4").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "label" },
          right: { type: "numeric-literal", format: "decimal", value: 4 },
        },
      });
    });

    it("parses subtraction", () => {
      const line = parseLine("  dc.w offset-8").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "-",
          left: { type: "symbol", name: "offset" },
          right: { type: "numeric-literal", format: "decimal", value: 8 },
        },
      });
    });

    it("parses multiplication", () => {
      const line = parseLine("  dc.w width*height").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "*",
          left: { type: "symbol", name: "width" },
          right: { type: "symbol", name: "height" },
        },
      });
    });

    it("parses division", () => {
      const line = parseLine("  dc.w total/count").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "/",
          left: { type: "symbol", name: "total" },
          right: { type: "symbol", name: "count" },
        },
      });
    });

    it("parses modulo with %", () => {
      const line = parseLine("  dc.w value%16").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "%",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "decimal", value: 16 },
        },
      });
    });

    it("parses modulo with //", () => {
      const line = parseLine("  dc.w value//16").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "%",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "decimal", value: 16 },
        },
      });
    });
  });

  describe("Bitwise operators", () => {
    it("parses bitwise AND", () => {
      const line = parseLine("  dc.w value&$FF").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "hex", value: 0xff },
        },
      });
    });

    it("parses bitwise OR with |", () => {
      const line = parseLine("  dc.w flags|$80").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "|",
          left: { type: "symbol", name: "flags" },
          right: { type: "numeric-literal", format: "hex", value: 0x80 },
        },
      });
    });

    it("parses bitwise OR with !", () => {
      const line = parseLine("  dc.w flags!$80").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "|",
          left: { type: "symbol", name: "flags" },
          right: { type: "numeric-literal", format: "hex", value: 0x80 },
        },
      });
    });

    it("parses bitwise XOR with ^", () => {
      const line = parseLine("  dc.w value^$FFFF").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "^",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "hex", value: 0xffff },
        },
      });
    });

    it("parses bitwise XOR with ~", () => {
      const line = parseLine("  dc.w value~$FFFF").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "^",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "hex", value: 0xffff },
        },
      });
    });

    it("parses left shift", () => {
      const line = parseLine("  dc.w 1<<8").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<<",
          left: { type: "numeric-literal", format: "decimal", value: 1 },
          right: { type: "numeric-literal", format: "decimal", value: 8 },
        },
      });
    });

    it("parses right shift", () => {
      const line = parseLine("  dc.w value>>4").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: ">>",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "decimal", value: 4 },
        },
      });
    });
  });

  describe("Comparison operators", () => {
    it("parses less than", () => {
      const line = parseLine("  dc.w a<b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses greater than", () => {
      const line = parseLine("  dc.w a>b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: ">",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses less than or equal", () => {
      const line = parseLine("  dc.w a<=b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<=",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses greater than or equal", () => {
      const line = parseLine("  dc.w a>=b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: ">=",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses equality with ==", () => {
      const line = parseLine("  dc.w a==b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "=",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses equality with =", () => {
      const line = parseLine("  dc.w a=b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "=",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses inequality with !=", () => {
      const line = parseLine("  dc.w a!=b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<>",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses inequality with <>", () => {
      const line = parseLine("  dc.w a<>b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<>",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });
  });

  describe("Logical operators", () => {
    it("parses logical AND", () => {
      const line = parseLine("  dc.w a&&b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&&",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses logical OR", () => {
      const line = parseLine("  dc.w a||b").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "||",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });
  });

  describe("Unary operators", () => {
    it("parses unary plus", () => {
      const line = parseLine("  dc.w +value").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "unary-op",
          operator: "+",
          operand: { type: "symbol", name: "value" },
        },
      });
    });

    it("parses unary minus", () => {
      const line = parseLine("  dc.w -value").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "unary-op",
          operator: "-",
          operand: { type: "symbol", name: "value" },
        },
      });
    });

    it("parses logical NOT", () => {
      const line = parseLine("  dc.w !flag").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "unary-op",
          operator: "!",
          operand: { type: "symbol", name: "flag" },
        },
      });
    });

    it("parses bitwise complement", () => {
      const line = parseLine("  dc.w ~mask").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "unary-op",
          operator: "~",
          operand: { type: "symbol", name: "mask" },
        },
      });
    });
  });

  describe("Parentheses and grouping", () => {
    it("parses grouped expressions", () => {
      const line = parseLine("  dc.w (a+b)*c").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "*",
          left: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "+",
              left: { type: "symbol", name: "a" },
              right: { type: "symbol", name: "b" },
            },
          },
          right: { type: "symbol", name: "c" },
        },
      });
    });

    it("parses nested parentheses", () => {
      const line = parseLine("  dc.w ((a+b)*c)+d").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "*",
              left: {
                type: "group",
                expression: {
                  type: "binary-op",
                  operator: "+",
                  left: { type: "symbol", name: "a" },
                  right: { type: "symbol", name: "b" },
                },
              },
              right: { type: "symbol", name: "c" },
            },
          },
          right: { type: "symbol", name: "d" },
        },
      });
    });

    // Asm-One style grouping, used by AsmPro and TRASH'M-One sources
    it("parses square brackets as a group", () => {
      const result = parseLine("  moveq #[end-start]/2-1,d7");
      expect(result.errors).toEqual([]);
      expect(result.value.operands?.[0]).toMatchObject({
        type: "immediate",
        value: {
          type: "binary-op",
          operator: "-",
          left: {
            type: "binary-op",
            operator: "/",
            left: {
              type: "group",
              loc: { start: 9, end: 20 },
              expression: { type: "binary-op", operator: "-" },
            },
          },
        },
      });
    });

    it("parses square brackets in a displacement and a directive", () => {
      const indirect = parseLine("  move.l (regs+[8+4]*4-DT,a4),d0");
      expect(indirect.errors).toEqual([]);
      expect(indirect.value.operands?.[0]).toMatchObject({
        type: "address-register-indirect-displacement",
        register: { type: "address-register", register: "a4" },
      });

      const directive = parseLine("  ds.b [DSIZE]*(10+1)");
      expect(directive.errors).toEqual([]);
      expect(directive.value.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "*",
          left: { type: "group", expression: { name: "DSIZE" } },
          right: { type: "group" },
        },
      });
    });

    it("reads a leading bracketed displacement apart from memory indirect", () => {
      const grouped = parseLine("  move.l ([a+b]*2,a0),d0");
      expect(grouped.errors).toEqual([]);
      expect(grouped.value.operands?.[0]).toMatchObject({
        type: "address-register-indirect-displacement",
        displacement: { type: "binary-op", left: { type: "group" } },
      });

      const indirect = parseLine("  move.l ([a0],d0),d1");
      expect(indirect.errors).toEqual([]);
      expect(indirect.value.operands?.[0]).toMatchObject({
        type: "memory-indirect",
      });
    });

    it("requires a group to close with its own bracket", () => {
      const result = parseLine("  dc.w [1+2)");
      expect(result.errors).toMatchObject([{ code: "UNCLOSED_BRACKET" }]);
    });
  });

  describe("Operator precedence", () => {
    it("multiplication before addition", () => {
      const line = parseLine("  dc.w a+b*c").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "a" },
          right: {
            type: "binary-op",
            operator: "*",
            left: { type: "symbol", name: "b" },
            right: { type: "symbol", name: "c" },
          },
        },
      });
    });

    it("shifts before bitwise AND", () => {
      const line = parseLine("  dc.w a<<2&mask").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&",
          left: {
            type: "binary-op",
            operator: "<<",
            left: { type: "symbol", name: "a" },
            right: { type: "numeric-literal", format: "decimal", value: 2 },
          },
          right: { type: "symbol", name: "mask" },
        },
      });
    });

    it("bitwise before arithmetic", () => {
      const line = parseLine("  dc.w a&b+c").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: {
            type: "binary-op",
            operator: "&",
            left: { type: "symbol", name: "a" },
            right: { type: "symbol", name: "b" },
          },
          right: { type: "symbol", name: "c" },
        },
      });
    });

    it("arithmetic before comparison", () => {
      const line = parseLine("  dc.w a+b<c").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<",
          left: {
            type: "binary-op",
            operator: "+",
            left: { type: "symbol", name: "a" },
            right: { type: "symbol", name: "b" },
          },
          right: { type: "symbol", name: "c" },
        },
      });
    });

    it("comparison before logical AND", () => {
      const line = parseLine("  dc.w a<b&&c>d").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&&",
          left: {
            type: "binary-op",
            operator: "<",
            left: { type: "symbol", name: "a" },
            right: { type: "symbol", name: "b" },
          },
          right: {
            type: "binary-op",
            operator: ">",
            left: { type: "symbol", name: "c" },
            right: { type: "symbol", name: "d" },
          },
        },
      });
    });
  });

  describe("Character literals", () => {
    it("parses a character literal inside a grouped expression", () => {
      const line = parseLine("ID_DOS_DISK EQU ('D'<<24)!('O'<<16)");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "|",
          left: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "<<",
              left: { type: "string-literal", quote: "'", content: "D" },
              right: { type: "numeric-literal", value: 24 },
            },
          },
        },
      });
    });

    it("parses a double-quoted literal in an expression", () => {
      const line = parseLine('  dc.l ("AB"<<8)');
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "group",
          expression: {
            left: { type: "string-literal", quote: '"', content: "AB" },
          },
        },
      });
    });

    it("parses a multi-character literal as an operand of an operator", () => {
      const line = parseLine("  move.l #'A'-'0',d0");
      expect(line.errors).toHaveLength(0);
    });

    it("reports an unterminated string in an expression", () => {
      const line = parseLine("  dc.l ('A<<8)");
      expect(line.errors[0]).toMatchObject({ code: "UNTERMINATED_STRING" });
    });
  });

  describe("Macro parameters embedded in symbols", () => {
    it("parses a symbol with a trailing \\@ in a grouped expression", () => {
      const line = parseLine("  DC.B (CMD\\@)!$80");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "|",
          left: {
            type: "group",
            expression: { type: "symbol", name: "CMD\\@" },
          },
          right: { type: "numeric-literal", format: "hex", value: 0x80 },
        },
      });
    });

    it("parses a symbol with an embedded numeric macro parameter", () => {
      const line = parseLine("  move.w #(BLTEN_\\1+1),d0");
      expect(line.errors).toHaveLength(0);
    });

    it("parses a symbol with a trailing \\@@ macro parameter", () => {
      const line = parseLine("  movem.l (sp)+,PUSHM_\\@@");
      expect(line.errors).toHaveLength(0);
    });

    it("still parses a standalone macro parameter as such", () => {
      const line = parseLine("  dc.w \\1+4");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          left: { type: "macro-parameter", paramType: "numeric", param: "1" },
        },
      });
    });
  });

  describe("Complex real-world expressions", () => {
    it("parses vasm example from docs", () => {
      const line = parseLine(
        "  dc.w (DIW_XSTRT-17+(DIW_W>>4-1)<<4)>>1&$fc-SCROLL*8",
      ).value;
      // Just verify it parses without error and produces a binary-op at top level
      const operand = line.operands?.[0];
      expect(operand?.type).toBe("value");
      if (operand?.type === "value") {
        expect(operand.value?.type).toBe("binary-op");
      }
    });

    it("parses label offset calculation", () => {
      const line = parseLine("  move label+4,d0").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "absolute-address",
        address: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "label" },
          right: { type: "numeric-literal", format: "decimal", value: 4 },
        },
      });
    });

    it("parses size calculation", () => {
      const line = parseLine("SIZE equ width*height").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "*",
          left: { type: "symbol", name: "width" },
          right: { type: "symbol", name: "height" },
        },
      });
    });

    it("parses bit mask expression", () => {
      const line = parseLine("  dc.w (value&$FF)|(flags<<8)").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "|",
          left: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "&",
              left: { type: "symbol", name: "value" },
              right: { type: "numeric-literal", format: "hex", value: 0xff },
            },
          },
          right: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "<<",
              left: { type: "symbol", name: "flags" },
              right: { type: "numeric-literal", format: "decimal", value: 8 },
            },
          },
        },
      });
    });

    it("parses current address expression", () => {
      const line = parseLine("  dc.w *+10").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: { type: "current-address" },
          right: { type: "numeric-literal", format: "decimal", value: 10 },
        },
      });
    });
  });

  describe("Expressions in different contexts", () => {
    it("parses expression in absolute address with size qualifier (parens)", () => {
      const line = parseLine("  move.l (BASE+4).w,d0").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "absolute-address",
        loc: { start: 9, end: 19 },
        address: {
          type: "group",
          loc: { start: 9, end: 17 },
          expression: {
            type: "binary-op",
            operator: "+",
            left: { type: "symbol", name: "BASE" },
            right: { type: "numeric-literal", format: "decimal", value: 4 },
          },
        },
        addressSize: {
          type: "size",
          size: "w",
        },
      });
    });

    it("parses expression in absolute address with size suffix", () => {
      const line = parseLine("  move.l BASE+offset.w,d0").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "absolute-address",
        addressSize: {
          type: "size",
          size: "w",
        },
        address: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "BASE" },
          right: { type: "symbol", name: "offset" },
        },
      });
    });

    it("parses expression in absolute address without size", () => {
      const line = parseLine("  move.l BASE+offset,d0").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "absolute-address",
        address: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "BASE" },
          right: { type: "symbol", name: "offset" },
        },
      });
    });

    it("parses expression in immediate operand", () => {
      const line = parseLine("  move #width*height,d0").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "immediate",
        value: {
          type: "binary-op",
          operator: "*",
          left: { type: "symbol", name: "width" },
          right: { type: "symbol", name: "height" },
        },
      });
    });

    it("parses expression in displacement", () => {
      const line = parseLine("  move base+offset(a0),d0").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "address-register-indirect-displacement",
        displacement: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "base" },
          right: { type: "symbol", name: "offset" },
        },
      });
    });

    it("parses bitwise operators in indexed addressing displacement", () => {
      const line = parseLine("  move.w #1,l~2(a1,d0.w)").value;
      expect(line.operands?.[1]).toMatchObject({
        type: "address-register-indirect-index",
        displacement: {
          type: "binary-op",
          operator: "^", // ~ is normalized to ^
          left: { type: "symbol", name: "l" },
          right: { type: "numeric-literal", format: "decimal", value: 2 },
        },
        baseRegister: {
          type: "address-register",
          register: "a1",
        },
        indexRegister: {
          type: "data-register",
          register: "d0",
        },
      });
    });

    it("parses expression in PC-relative", () => {
      const line = parseLine("  bra table+index*4(pc)").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "pc-relative",
        displacement: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "table" },
          right: {
            type: "binary-op",
            operator: "*",
            left: { type: "symbol", name: "index" },
            right: { type: "numeric-literal", format: "decimal", value: 4 },
          },
        },
      });
    });
  });

  describe("Numeric literal parsing", () => {
    it("parses decimal numbers", () => {
      const line1 = parseLine("  dc.w 42").value;
      expect(line1.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
          raw: "42",
          value: 42,
        },
      });

      const line2 = parseLine("  dc.w 0").value;
      expect(line2.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
          raw: "0",
          value: 0,
        },
      });

      const line3 = parseLine("  dc.w 65535").value;
      expect(line3.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
          raw: "65535",
          value: 65535,
        },
      });
    });

    it("parses hexadecimal numbers", () => {
      const line1 = parseLine("  dc.w $FF").value;
      expect(line1.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
          raw: "$FF",
          value: 255,
        },
      });

      const line2 = parseLine("  dc.w $1234").value;
      expect(line2.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
          raw: "$1234",
          value: 0x1234,
        },
      });

      const line3 = parseLine("  dc.w $ABCD").value;
      expect(line3.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
          raw: "$ABCD",
          value: 0xabcd,
        },
      });

      const line4 = parseLine("  dc.w $0").value;
      expect(line4.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
          raw: "$0",
          value: 0,
        },
      });
    });

    it("parses binary numbers", () => {
      const line1 = parseLine("  dc.w %1010").value;
      expect(line1.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
          raw: "%1010",
          value: 10,
        },
      });

      const line2 = parseLine("  dc.w %11111111").value;
      expect(line2.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
          raw: "%11111111",
          value: 255,
        },
      });

      const line3 = parseLine("  dc.w %1").value;
      expect(line3.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
          raw: "%1",
          value: 1,
        },
      });

      const line4 = parseLine("  dc.w %0").value;
      expect(line4.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
          raw: "%0",
          value: 0,
        },
      });
    });

    it("parses octal numbers", () => {
      const line1 = parseLine("  dc.w @77").value;
      expect(line1.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
          raw: "@77",
          value: 63,
        },
      });

      const line2 = parseLine("  dc.w @377").value;
      expect(line2.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
          raw: "@377",
          value: 255,
        },
      });

      const line3 = parseLine("  dc.w @7").value;
      expect(line3.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
          raw: "@7",
          value: 7,
        },
      });

      const line4 = parseLine("  dc.w @0").value;
      expect(line4.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
          raw: "@0",
          value: 0,
        },
      });
    });
  });

  describe("Built-in symbols", () => {
    it("parses __RS offset counter", () => {
      const line = parseLine("  dc.w __RS+4").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: {
            type: "builtin-symbol",
            name: "__RS",
          },
          right: {
            type: "numeric-literal",
            value: 4,
          },
        },
      });
    });

    it("parses __SO offset counter", () => {
      const line = parseLine("  dc.w __SO").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__SO",
        },
      });
    });

    it("parses __FO offset counter", () => {
      const line = parseLine("  dc.w __FO").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__FO",
        },
      });
    });

    it("parses REPTN repeat counter", () => {
      const line = parseLine("  dc.w REPTN*2").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "*",
          left: {
            type: "builtin-symbol",
            name: "REPTN",
          },
          right: {
            type: "numeric-literal",
            value: 2,
          },
        },
      });
    });

    it("parses CARG argument counter", () => {
      const line = parseLine("  dc.w CARG").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "CARG",
        },
      });
    });

    it("parses NARG argument count", () => {
      const line = parseLine("  dc.w NARG").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "NARG",
        },
      });
    });

    it("parses __G2 Devpac CPU type symbol", () => {
      const line = parseLine("  dc.w __G2").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__G2",
        },
      });
    });

    it("parses __LK Devpac output file type symbol", () => {
      const line = parseLine("  dc.w __LK").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__LK",
        },
      });
    });

    it("parses __CPU PhxAss CPU type symbol", () => {
      const line = parseLine("  dc.w __CPU").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__CPU",
        },
      });
    });

    it("parses __FPU PhxAss FPU type symbol", () => {
      const line = parseLine("  dc.w __FPU").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__FPU",
        },
      });
    });

    it("parses __MMU PhxAss MMU type symbol", () => {
      const line = parseLine("  dc.w __MMU").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__MMU",
        },
      });
    });

    it("parses __OPTC PhxAss optimization flags symbol", () => {
      const line = parseLine("  dc.w __OPTC").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__OPTC",
        },
      });
    });

    it("parses _MOVEMBYTES BAsm MOVEM bytes symbol", () => {
      const line = parseLine("  dc.w _MOVEMBYTES").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "_MOVEMBYTES",
        },
      });
    });

    it("parses __MOVEMREGS BAsm MOVEM register count symbol", () => {
      const line = parseLine("  dc.w __MOVEMREGS").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "builtin-symbol",
          name: "__MOVEMREGS",
        },
      });
    });

    it("parses __VASM version/CPU bitfield symbol", () => {
      const line = parseLine("  dc.w __VASM&$ff").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&",
          left: {
            type: "builtin-symbol",
            name: "__VASM",
          },
          right: {
            type: "numeric-literal",
            value: 255,
          },
        },
      });
    });

    it("treats similar names as regular symbols", () => {
      const line = parseLine("  dc.w __RSX").value;
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "symbol",
          name: "__RSX",
        },
      });
    });
  });

  describe("shift operators across an operand list", () => {
    it("does not read a later operand's '>' as closing an angle string", () => {
      // The `<` in `(24<<6)` used to start a lookahead for a matching `>`,
      // which found the one in a following operand and swallowed everything
      // between as a string literal.
      const line = parseLine(
        "  dc.w 1,((W+16)>>4)|(24<<6),0,((W+16)>>4)|(24<<6)",
      );
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands).toHaveLength(4);
    });

    it("still treats a leading <text> as a string", () => {
      const line = parseLine("  MyMacro <a,b>,c");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0]).toMatchObject({
        type: "string-literal",
        content: "a,b",
      });
      expect(line.value.operands).toHaveLength(2);
    });

    it("treats a shift in an expression as an operator", () => {
      const line = parseLine("  dc.w (24<<6),0,(W>>4)");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands).toHaveLength(3);
    });
  });

  describe("macro parameter locations", () => {
    it("spans the backslash for a parameter inside an expression", () => {
      // The tokenizer strips the leading backslash from the token value, so
      // the length has to be adjusted or the location comes up one short.
      const src = "  dc.w    CopOffs+\\1";
      const operand = parseLine(src).value.operands?.[0] as {
        value: { right: { loc: { start: number; end: number } } };
      };
      const param = operand.value.right;
      expect(src.slice(param.loc.start, param.loc.end)).toBe("\\1");
    });

    it("spans a named parameter inside an expression", () => {
      const src = "  dc.w    A+\\<name>";
      const operand = parseLine(src).value.operands?.[0] as {
        value: { right: { loc: { start: number; end: number } } };
      };
      const param = operand.value.right;
      expect(src.slice(param.loc.start, param.loc.end)).toBe("\\<name>");
    });

    it("keeps expression structure for a macro argument with a parameter", () => {
      // The under-coverage check that falls back to raw text must not misfire
      // here: `CopOffs+\1` is a perfectly good expression.
      const line = parseLine("  SetCop CopOffs+\\1,d0");
      expect(line.value.operands?.[0].type).toBe("value");
    });
  });

  describe("float literals", () => {
    const literal = (src: string) => {
      const operand = parseLine(src).value.operands?.[0] as {
        value?: { format?: string; raw?: string; value?: number } | number;
        format?: string;
        raw?: string;
      };
      return operand.value ?? operand;
    };

    it("reads a decimal point as a float", () => {
      // vasm's dc.s/.d/.x/.p and fequ take floating point values; without
      // this the fraction was dropped and `dc.s 1.5` became 1.
      expect(literal(" dc.s 1.5")).toMatchObject({
        format: "float",
        raw: "1.5",
        value: 1.5,
      });
      expect(literal("X fequ 3.14")).toMatchObject({
        format: "float",
        value: 3.14,
      });
    });

    it("reads an exponent as part of a float", () => {
      expect(literal(" dc.s 1.5e3")).toMatchObject({
        format: "float",
        value: 1500,
      });
      expect(literal(" dc.s 1.5e-3")).toMatchObject({
        format: "float",
        value: 0.0015,
      });
    });

    it("still reads a whole number as decimal", () => {
      expect(literal(" dc.w 1")).toMatchObject({
        format: "decimal",
        value: 1,
      });
    });

    it("does not treat an address size suffix as a float", () => {
      // `1.w` is a word-sized absolute address, not the number 1.w
      expect(parseLine(" move.w 1.w,d0").value.operands?.[0]).toMatchObject({
        type: "absolute-address",
      });
      expect(parseLine(" move.w 1.w,d0").errors).toHaveLength(0);
    });

    it("does not treat a leading dot as a float", () => {
      // A leading dot begins a local label.
      expect(parseLine(" bra .loop").value.operands?.[0]).toMatchObject({
        type: "absolute-address",
      });
    });

    it("leaves a bare exponent alone", () => {
      // `1e3` is too ambiguous to guess at, so it stays a number.
      expect(literal(" dc.w 1e3")).toMatchObject({ format: "decimal" });
    });
  });
});
