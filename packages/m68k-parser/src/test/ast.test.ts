import type { Location } from "../types.js";
import { parseLine } from "../index.js";

describe("parse AST", () => {
  describe("#parseLine() with type information", () => {
    it("parses labels with scope", () => {
      const global = parseLine("label:").value;
      expect(global.label).toMatchObject({
        type: "label",
        label: "label",
        scope: "global",
      });

      const local = parseLine(".local:").value;
      expect(local.label).toMatchObject({
        type: "label",
        label: ".local",
        scope: "local",
      });

      const external = parseLine("exported::").value;
      expect(external.label).toMatchObject({
        type: "label",
        label: "exported",
        scope: "external",
      });
    });

    it("ignores colons inside string operands when looking for a label", () => {
      // An indented line needs a colon to hold a label, but one inside a
      // string belongs to the text: `LOG_INFO` here is a macro invocation.
      const macro = parseLine(
        '  LOG_INFO "DOS: part preloaded (%d hunks)",d6',
      ).value;
      expect(macro.label).toBeUndefined();
      expect(macro.mnemonic).toMatchObject({
        type: "macro",
        macro: "LOG_INFO",
      });
      expect(macro.operands).toHaveLength(2);

      const single = parseLine("  LOG_INFO 'a:b'").value;
      expect(single.label).toBeUndefined();
      expect(single.mnemonic).toMatchObject({ type: "macro" });

      // A real indented label is still one.
      expect(parseLine("  indented:").value.label).toMatchObject({
        type: "label",
        label: "indented",
      });
      expect(parseLine('  after: LOG_INFO "x: y"').value.label).toMatchObject({
        type: "label",
        label: "after",
      });
    });

    it("parses instructions, directives, and macros", () => {
      const instruction = parseLine("  move d0,d1").value;
      expect(instruction.mnemonic).toMatchObject({
        type: "instruction",
        instruction: "move",
      });

      const directive = parseLine("  dc.b 1").value;
      expect(directive.mnemonic).toMatchObject({
        type: "directive",
        directive: "dc",
      });

      const macro = parseLine("  foo").value;
      expect(macro.mnemonic).toMatchObject({
        type: "macro",
        macro: "foo",
      });
    });

    it("parses size with type", () => {
      const line = parseLine("  move.w d0,d1").value;
      expect(line.qualifier).toMatchObject({
        type: "size",
        size: "w",
      });
    });

    it("parses comments with hasPrefix", () => {
      const withPrefix = parseLine("  move d0,d1 ; comment").value;
      expect(withPrefix.comment).toMatchObject({
        type: "comment",
        hasPrefix: true,
        content: "comment",
      });

      const positional = parseLine("  rts comment here").value;
      expect(positional.comment).toMatchObject({
        type: "comment",
        hasPrefix: false,
        content: "comment here",
      });
    });

    describe("operand addressing modes", () => {
      it("parses data registers", () => {
        const line = parseLine("  move d0,d7").value;
        expect(line.operands).toHaveLength(2);
        expect(line.operands?.[0]).toMatchObject({
          type: "data-register",
          register: "d0",
        });
        expect(line.operands?.[1]).toMatchObject({
          type: "data-register",
          register: "d7",
        });
      });

      it("parses address registers", () => {
        const line = parseLine("  move a0,sp").value;
        expect(line.operands).toHaveLength(2);
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register",
          register: "a0",
        });
        expect(line.operands?.[1]).toMatchObject({
          type: "address-register",
          register: "sp",
        });
      });

      it("parses special registers", () => {
        // Status Register
        const sr = parseLine("  move sr,d0").value;
        expect(sr.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "sr",
        });

        // Condition Code Register
        const ccr = parseLine("  move d0,ccr").value;
        expect(ccr.operands?.[1]).toMatchObject({
          type: "special-register",
          register: "ccr",
        });

        // User Stack Pointer
        const usp = parseLine("  move usp,a0").value;
        expect(usp.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "usp",
        });

        // Supervisor Stack Pointer
        const ssp = parseLine("  move ssp,a1").value;
        expect(ssp.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "ssp",
        });

        // Program Counter (in some contexts)
        const pc = parseLine("  move pc,d0").value;
        expect(pc.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "pc",
        });

        // 68010+ registers
        const vbr = parseLine("  movec vbr,d0").value;
        expect(vbr.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "vbr",
        });
      });

      it("parses immediate values", () => {
        const line = parseLine("  move #100,d0").value;
        expect(line.operands?.[0]).toMatchObject({
          type: "immediate",
          value: {
            type: "numeric-literal",
            format: "decimal",
          },
        });
      });

      it("parses address register indirect", () => {
        const simple = parseLine("  move (a0),d0").value;
        expect(simple.operands?.[0]).toMatchObject({
          type: "address-register-indirect",
          register: {
            type: "address-register",
            register: "a0",
          },
        });

        const postInc = parseLine("  move (a0)+,d0").value;
        expect(postInc.operands?.[0]).toMatchObject({
          type: "address-register-indirect-postinc",
          register: {
            type: "address-register",
            register: "a0",
          },
        });

        const preDec = parseLine("  move -(a0),d0").value;
        expect(preDec.operands?.[0]).toMatchObject({
          type: "address-register-indirect-predec",
          register: {
            type: "address-register",
            register: "a0",
          },
        });
      });

      it("parses address register indirect with displacement", () => {
        const line = parseLine("  move 10(a0),d0").value;
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register-indirect-displacement",
          displacement: {
            type: "numeric-literal",
            format: "decimal",
          },
          register: {
            type: "address-register",
            register: "a0",
          },
        });
      });

      it("parses address register indirect with index (dot syntax)", () => {
        const line = parseLine("  move 10(a0,d1.w),d0").value;
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register-indirect-index",
          displacement: {
            type: "numeric-literal",
            format: "decimal",
          },
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
        });
      });

      it("parses a register alias as the index register", () => {
        // `sin equr a1` / `x equr d5` makes this ordinary indexed addressing.
        // Resolving the names needs a symbol table, so they come back as
        // symbols rather than being rejected.
        const line = parseLine("  move.w (sin,x),d2");
        expect(line.errors).toHaveLength(0);
        expect(line.value.operands?.[0]).toMatchObject({
          type: "address-register-indirect-index",
          baseRegister: {
            type: "symbol",
            name: "sin",
          },
          indexRegister: {
            type: "symbol",
            name: "x",
          },
        });
      });

      it("parses a register alias index with size and scale", () => {
        const line = parseLine("  move.w 8(a0,idx.w*4),d2");
        expect(line.errors).toHaveLength(0);
        expect(line.value.operands?.[0]).toMatchObject({
          type: "address-register-indirect-index",
          indexRegister: {
            type: "symbol",
            name: "idx",
          },
          indexSize: {
            type: "size",
            size: "w",
          },
        });
      });

      it("parses a parenthesised displacement with an index", () => {
        const line = parseLine("  lea (WIDTH+32)/8(a0,d0.w),a2");
        expect(line.errors).toHaveLength(0);
        expect(line.value.operands?.[0]).toMatchObject({
          type: "address-register-indirect-index",
          displacement: { type: "binary-op", operator: "/" },
          baseRegister: { type: "address-register", register: "a0" },
          indexRegister: { type: "data-register", register: "d0" },
        });
      });

      it("locates the base register after a parenthesised displacement", () => {
        // The register belongs to the final group, not the first paren.
        const src = "  lea (WIDTH+32)/8(a0,d0.w),a2";
        const operand = parseLine(src).value.operands?.[0];
        const base = (operand as { baseRegister: { loc: Location } })
          .baseRegister;
        expect(src.slice(base.loc.start, base.loc.end)).toBe("a0");
      });

      it("locates the register after a parenthesised displacement", () => {
        const src = "  move.w (WIDTH+32)/8(a0),d0";
        const operand = parseLine(src).value.operands?.[0];
        const register = (operand as { register: { loc: Location } }).register;
        expect(src.slice(register.loc.start, register.loc.end)).toBe("a0");
      });

      it("parses a macro parameter as the register with a displacement", () => {
        const line = parseLine("  btst #0,(vposr+1,\\1)");
        expect(line.errors).toHaveLength(0);
        expect(line.value.operands?.[1]).toMatchObject({
          type: "address-register-indirect-displacement",
          register: { type: "macro-parameter" },
        });
      });

      it("parses PC relative", () => {
        const simple = parseLine("  bra label(pc)").value;
        expect(simple.operands?.[0]).toMatchObject({
          type: "pc-relative",
          displacement: {
            type: "symbol",
            name: "label",
          },
        });

        const indexed = parseLine("  move offset(pc,d0.w),d1").value;
        expect(indexed.operands?.[0]).toMatchObject({
          type: "pc-relative-index",
          displacement: {
            type: "symbol",
            name: "offset",
          },
          indexRegister: {
            type: "data-register",
            register: "d0",
          },
          indexSize: {
            type: "size",
            size: "w",
          },
        });
      });

      it("parses string literals", () => {
        const double = parseLine('  dc.b "hello"').value;
        expect(double.operands?.[0]).toMatchObject({
          type: "string-literal",
          quote: '"',
          content: "hello",
        });

        const single = parseLine("  dc.b 'world'").value;
        expect(single.operands?.[0]).toMatchObject({
          type: "string-literal",
          quote: "'",
          content: "world",
        });

        const chevron = parseLine("  macro <arg>").value;
        expect(chevron.operands?.[0]).toMatchObject({
          type: "string-literal",
          quote: "<>",
          content: "arg",
        });
      });

      it("parses absolute addresses", () => {
        // Absolute with explicit size in parens
        const sizedParens = parseLine("  move ($1000).w,d0").value;
        expect(sizedParens.operands?.[0]).toMatchObject({
          type: "absolute-address",
          loc: { start: 7, end: 16 },
          address: {
            type: "group",
            loc: { start: 7, end: 14 },
            expression: {
              type: "numeric-literal",
              format: "hex",
              value: 0x1000,
              loc: { start: 8, end: 13 },
            },
          },
          addressSize: {
            type: "size",
            size: "w",
          },
        });

        // Absolute short (hex with $)
        const hexAddr = parseLine("  move $1000,d0").value;
        expect(hexAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "hex",
          },
        });

        // Absolute with binary literal
        const binAddr = parseLine("  move %10110101,d0").value;
        expect(binAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "binary",
          },
        });

        // Absolute with octal literal
        const octAddr = parseLine("  move @377,d0").value;
        expect(octAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "octal",
          },
        });

        // Absolute with decimal number
        const decAddr = parseLine("  move 32768,d0").value;
        expect(decAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "decimal",
          },
        });

        // Absolute with .w suffix (without parens)
        const shortSuffix = parseLine("  move $1000.w,d0").value;
        expect(shortSuffix.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "hex",
          },
          addressSize: {
            type: "size",
            size: "w",
          },
        });

        // Absolute with .l suffix (without parens)
        const longSuffix = parseLine("  move $FF0000.l,d0").value;
        expect(longSuffix.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "hex",
          },
          addressSize: {
            type: "size",
            size: "l",
          },
        });
      });

      it("parses expressions", () => {
        // Simple symbol in instruction context - becomes absolute-address
        const line = parseLine("  move.l label,d0").value;
        expect(line.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "symbol",
            name: "label",
          },
        });

        // Complex expression in directive context - becomes value with parsed expression
        const expr = parseLine("  dc.w $1000+offset").value;
        expect(expr.operands?.[0]).toMatchObject({
          type: "value",
          value: {
            type: "binary-op",
            operator: "+",
          },
        });
      });

      it("parses unknown/incomplete operands", () => {
        const line = parseLine("  move d0,").value;
        expect(line.operands).toHaveLength(2);
        expect(line.operands?.[1]).toMatchObject({
          type: "unknown",
        });
      });

      it("parses register lists", () => {
        // Simple register range
        const range = parseLine("  movem d0-d7,-(sp)").value;
        expect(range.operands?.[0]).toMatchObject({
          type: "register-list",
          raw: ["d0-d7"],
          registers: ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"],
        });

        // Multiple ranges with slash
        const multi = parseLine("  movem d0-d7/a0-a6,(sp)").value;
        expect(multi.operands?.[0]).toMatchObject({
          type: "register-list",
          raw: ["d0-d7", "a0-a6"],
          registers: [
            "d0",
            "d1",
            "d2",
            "d3",
            "d4",
            "d5",
            "d6",
            "d7",
            "a0",
            "a1",
            "a2",
            "a3",
            "a4",
            "a5",
            "a6",
          ],
        });

        // Individual registers
        const individual = parseLine("  movem d0/d1/a0,(a0)").value;
        expect(individual.operands?.[0]).toMatchObject({
          type: "register-list",
          raw: ["d0", "d1", "a0"],
          registers: ["d0", "d1", "a0"],
        });

        // Mixed ranges and individuals
        const mixed = parseLine("  movem d0-d2/d5/a0-a1,(sp)+").value;
        expect(mixed.operands?.[0]).toMatchObject({
          type: "register-list",
          raw: ["d0-d2", "d5", "a0-a1"],
          registers: ["d0", "d1", "d2", "d5", "a0", "a1"],
        });
      });

      it("parses macro parameters", () => {
        // Numeric parameter
        const numeric = parseLine("  move \\1,d0").value;
        expect(numeric.operands?.[0]).toMatchObject({
          type: "macro-parameter",
          paramType: "numeric",
          param: "1",
        });

        // Special parameter (@) - as standalone operand
        const special = parseLine("  move d0,\\@").value;
        expect(special.operands?.[1]).toMatchObject({
          type: "macro-parameter",
          paramType: "special",
          param: "@",
        });

        // Named parameter
        const named = parseLine("  move \\<size>,d0").value;
        expect(named.operands?.[0]).toMatchObject({
          type: "macro-parameter",
          paramType: "named",
          param: "<size>",
        });
      });
    });

    describe("macro definition lines", () => {
      it("parses a parameter name list as operands", () => {
        const line = parseLine("MyMacro macro arg1,arg2");
        expect(line.errors).toHaveLength(0);
        expect(line.value.operands).toHaveLength(2);
        expect(line.value.operands?.[0]).toMatchObject({
          type: "value",
          value: { type: "symbol", name: "arg1" },
        });
      });

      it("treats free-form argument documentation as a comment", () => {
        // exec/alerts.i documents the arguments on the definition line
        const line = parseLine("ALERT\t\tMACRO\t(alertNumber, [paramArray])");
        expect(line.errors).toHaveLength(0);
        expect(line.value.operands).toBeUndefined();
        expect(line.value.comment).toMatchObject({
          hasPrefix: false,
          content: "(alertNumber, [paramArray])",
        });
      });

      it("treats a slash-style argument list as a comment", () => {
        // libraries/nonvolatile.i style: MACRO ;DataPtr SizeReg
        const line = parseLine("SizeNVData\tMACRO\t;DataPtr SizeReg");
        expect(line.errors).toHaveLength(0);
        expect(line.value.operands).toBeUndefined();
      });
    });

    it("parses directive operands as value type", () => {
      // Data definition directives should have value operands, not absolute-address
      const dcb = parseLine("  dc.b 0,1,2").value;
      expect(dcb.mnemonic).toMatchObject({});
      expect(dcb.operands).toHaveLength(3);
      expect(dcb.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
      });
      expect(dcb.operands?.[1]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
      });
      expect(dcb.operands?.[2]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
      });

      // Hex values in directives
      const dcw = parseLine("  dc.w $1000,$2000").value;
      expect(dcw.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
        },
      });

      // Binary values in directives
      const dcbin = parseLine("  dc.b %11110000").value;
      expect(dcbin.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
        },
      });

      // Octal values in directives
      const dcoct = parseLine("  dc.b @377").value;
      expect(dcoct.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
        },
      });
    });

    it("parses equate directives", () => {
      // EQU directive
      const equ = parseLine("MYCONST equ $1000").value;
      expect(equ.label).toMatchObject({
        type: "label",
        scope: "global",
      });
      expect(equ.mnemonic).toMatchObject({});
      expect(equ.operands).toHaveLength(1);
      expect(equ.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
        },
      });

      // SET directive
      const set = parseLine("MYVAR set 100").value;
      expect(set.label).toMatchObject({
        type: "label",
        scope: "global",
      });
      expect(set.mnemonic).toMatchObject({});

      // = directive (already tested in index.test.ts but verify AST)
      const equals = parseLine("VALUE = $FF").value;
      expect(equals.label).toMatchObject({
        type: "label",
        scope: "global",
      });
      expect(equals.mnemonic).toMatchObject({});

      // = directive without whitespace
      const equalsNoSpace = parseLine("FOO=1").value;
      expect(equalsNoSpace.label).toMatchObject({
        type: "label",
        scope: "global",
      });
      expect(equalsNoSpace.mnemonic).toMatchObject({});
      expect(equalsNoSpace.operands).toHaveLength(1);
      expect(equalsNoSpace.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
      });
    });

    it("parses a complete instruction with all AST features", () => {
      const line = parseLine(
        "label:    move.w     #1,10(a0,d1.w)    ; comment here",
      ).value;

      expect(line.label).toMatchObject({
        type: "label",
        scope: "global",
        loc: { start: 0, end: 5 },
      });

      expect(line.mnemonic).toMatchObject({
        type: "instruction",
        loc: { start: 10, end: 14 },
      });

      expect(line.qualifier).toMatchObject({
        type: "size",
        loc: { start: 15, end: 16 },
      });

      expect(line.operands).toHaveLength(2);

      expect(line.operands?.[0]).toMatchObject({
        type: "immediate",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
        loc: { start: 21, end: 23 },
      });

      expect(line.operands?.[1]).toMatchObject({
        type: "address-register-indirect-index",
        displacement: {
          type: "numeric-literal",
          format: "decimal",
        },
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
        loc: { start: 24, end: 35 },
      });

      expect(line.comment).toMatchObject({
        type: "comment",
        hasPrefix: true,
        loc: { start: 39, end: 53 },
      });
    });

    describe("macro arguments and interpolated names", () => {
      it("keeps a macro argument that is not an expression as text", () => {
        // `24BITDMA` cannot be an identifier, but a macro argument is
        // substituted textually, so it does not have to be one.
        const line = parseLine("  BITDEF  MEM,24BITDMA,9");
        expect(line.errors).toHaveLength(0);
        expect(line.value.operands?.[1]).toMatchObject({
          type: "macro-argument",
          text: "24BITDMA",
        });
      });

      it("keeps structure for macro arguments that do parse", () => {
        const line = parseLine("  MyMacro d0,d1");
        expect(line.value.operands?.map((o) => o.type)).toEqual([
          "data-register",
          "data-register",
        ]);
      });

      it("does not apply the text fallback to real instructions", () => {
        const line = parseLine("  move.w d0,d1");
        expect(line.value.operands?.map((o) => o.type)).toEqual([
          "data-register",
          "data-register",
        ]);
      });

      it("marks a symbol whose name embeds a placeholder", () => {
        const line = parseLine("    move.w  BLTEN_\\1,d0");
        const operand = line.value.operands?.[0] as {
          address: { name: string; interpolated?: boolean };
        };
        expect(operand.address).toMatchObject({
          name: "BLTEN_\\1",
          interpolated: true,
        });
      });

      it("marks a label whose name embeds a placeholder", () => {
        expect(parseLine(".loop\\@:").value.label).toMatchObject({
          label: ".loop\\@",
          interpolated: true,
        });
      });

      it("leaves ordinary names unmarked", () => {
        expect(
          parseLine("RealLabel:").value.label?.interpolated,
        ).toBeUndefined();
        const operand = parseLine("  move.w Sym,d0").value.operands?.[0] as {
          address: { interpolated?: boolean };
        };
        expect(operand.address.interpolated).toBeUndefined();
      });
    });
  });
});
