import fs from "fs";
import parse from "../../src/parse";
import { calculateTotals } from "../../src/totals";
import { type EffectiveAddressNode } from "../../src/parse/nodes";
import {
  Mnemonics,
  AddressingModes,
  Qualifiers,
  Directives,
} from "../../src/syntax";

describe("parse()", () => {
  test("parse file", () => {
    const file = fs
      .readFileSync(__dirname + "/../examples/example.s")
      .toString();
    const result = parse(file);
    expect(result).toHaveLength(843);
  });

  describe("instruction parsing", () => {
    test("two operands", () => {
      const [result] = parse("  move.w d0,(a0) ; foo");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (
          result.statement
            .operands[0] as EffectiveAddressNode as EffectiveAddressNode
        ).mode,
      ).toEqual(AddressingModes.Dn);
      expect(
        (
          result.statement
            .operands[1] as EffectiveAddressNode as EffectiveAddressNode
        ).mode,
      ).toEqual(AddressingModes.AnIndir);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("single operand", () => {
      const [result] = parse("  ext.w d0");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.EXT);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (
          result.statement
            .operands[0] as EffectiveAddressNode as EffectiveAddressNode
        ).mode,
      ).toEqual(AddressingModes.Dn);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("unary", () => {
      const [result] = parse("  rts");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.RTS);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("complex expression", () => {
      const [result] = parse(
        "foo:   move.w      #(CopperE-Copper)/4-1,d0;foo bar baz",
      );
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Imm);
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Dn);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("with comment", () => {
      const [result] = parse("   move.w     d0,(a0);foo bar baz");
      expect(result.statement.comment.text).toEqual(";foo bar baz");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Dn);
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.AnIndir);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("with comment - alt", () => {
      const [result] = parse("   move.w     d0,(a0) *foo bar baz");
      expect(result.statement.comment.text).toEqual("*foo bar baz");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Dn);
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.AnIndir);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("with label", () => {
      const [result] = parse("foo:   move.w     d0,(a0)");
      expect(result.statement.label.text).toEqual("foo");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Dn);
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.AnIndir);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("with label - local", () => {
      const [result] = parse(".foo:   move.w     d0,(a0)");
      expect(result.statement.label.text).toEqual(".foo");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Dn);
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.AnIndir);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("with label - no colon", () => {
      const [result] = parse("foo   move.w     d0,(a0)");
      expect(result.statement.label.text).toEqual("foo");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Dn);
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.AnIndir);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("default qualifier", () => {
      const [result] = parse("  MOVE D0,(A0)");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier).toBeFalsy();
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Dn);
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.AnIndir);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });

    test("case insensitive", () => {
      const [result] = parse("  MOVE.W D0,(A0)");
      expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
      expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.Dn);
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).mode,
      ).toEqual(AddressingModes.AnIndir);
      expect(result.timing).toBeTruthy();
      expect(result.bytes).toBeTruthy();
    });
  });

  test("label no space", () => {
    const [result] = parse("a:MOVE.W D0,(A0)");
    expect(result.statement.label.text).toEqual("a");
    expect(result.statement.opcode.op.name).toEqual(Mnemonics.MOVE);
    expect(result.statement.opcode.qualifier.name).toEqual(Qualifiers.W);
    expect((result.statement.operands[0] as EffectiveAddressNode).mode).toEqual(
      AddressingModes.Dn,
    );
    expect((result.statement.operands[1] as EffectiveAddressNode).mode).toEqual(
      AddressingModes.AnIndir,
    );
    expect(result.timing).toBeTruthy();
    expect(result.bytes).toBeTruthy();
  });

  describe("directives", () => {
    test("assignment EQU", () => {
      const [result] = parse("foo EQU 1");
      expect(result.statement.label.text).toEqual("foo");
      expect(result.statement.opcode.op.name).toEqual(Directives.EQU);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).text,
      ).toEqual("1");
    });

    test("assignment =", () => {
      const [result] = parse("foo = 1");
      expect(result.statement.label.text).toEqual("foo");
      expect(result.statement.opcode.op.name).toEqual(Directives["="]);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).text,
      ).toEqual("1");
    });

    test("assignment =", () => {
      const [result] = parse("foo=1");
      expect(result.statement.label.text).toEqual("foo");
      expect(result.statement.opcode.op.name).toEqual(Directives["="]);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).text,
      ).toEqual("1");
    });

    test("memory", () => {
      const [result] = parse("a: dc.w 1,2,3");
      expect(result.statement.label.text).toEqual("a");
      expect(result.statement.opcode.op.name).toEqual(Directives.DC);
      expect(
        (result.statement.operands[0] as EffectiveAddressNode).text,
      ).toEqual("1");
      expect(
        (result.statement.operands[1] as EffectiveAddressNode).text,
      ).toEqual("2");
      expect(result.statement.operands[2].text).toEqual("3");
    });

    test("macro definition", () => {
      const [result] = parse("a: macro");
      expect(result.statement.label.text).toEqual("a");
      expect(result.statement.opcode.op.name).toEqual(Directives.MACRO);
    });

    test("macro invocation: label", () => {
      const lines = parse(`
a:    macro
      move.w \\1,\\2
      endm
      a d0,(a0)`);
      expect(lines[4].macroLines).toHaveLength(1);
      expect(lines[4].bytes).toEqual(2);
      expect(lines[4].timing?.values).toEqual([[8, 1, 1]]);
    });

    test("macro invocation: operand", () => {
      const lines = parse(`
      macro a
      move.w \\1,\\2
      endm
      a d0,(a0)`);
      expect(lines[4].macroLines).toHaveLength(1);
      expect(lines[4].bytes).toEqual(2);
      expect(lines[4].timing?.values).toEqual([[8, 1, 1]]);
    });

    test("macro definition body is annotated for reference", () => {
      const lines = parse(`
a:    macro
      add.l d0,d1
      endm
      a`);
      // Body line is annotated with timing/size but flagged as reference
      expect(lines[2].reference).toBe(true);
      expect(lines[2].bytes).toEqual(2);
      expect(lines[2].timing?.values).toEqual([[8, 1, 0]]);
    });

    test("macro definition body excluded from totals", () => {
      const lines = parse(`
a:    macro
      add.l d0,d1
      endm`);
      // Only the reference definition body, no invocation
      expect(calculateTotals(lines).bytes).toEqual(0);
    });

    test("macro invocation: repeated argument", () => {
      const lines = parse(`
a:    macro
      move.w \\1,\\1
      endm
      a d3`);
      // Both occurrences of \\1 are substituted -> move.w d3,d3
      expect(lines[4].bytes).toEqual(2);
      expect(lines[4].timing?.values).toEqual([[4, 1, 0]]);
    });

    test("rept", () => {
      const lines = parse(`
      rept 4
      move.w d0,(a0)
      endr`);
      expect(lines[3].macroLines).toHaveLength(4);
      expect(lines[3].bytes).toEqual(2 * 4);
      expect(lines[3].timing.values).toEqual([[8 * 4, 4, 4]]);
    });

    test("rept body is reference and not double-counted", () => {
      const lines = parse(`
      rept 4
      move.w d0,(a0)
      endr`);
      // Body line annotated with single-iteration cost, flagged reference
      expect(lines[2].reference).toBe(true);
      expect(lines[2].bytes).toEqual(2);
      expect(lines[2].timing?.values).toEqual([[8, 1, 1]]);
      // Total counts the loop once (4 x 2 bytes), not the body line as well
      expect(calculateTotals(lines).bytes).toEqual(8);
    });

    test("bss section", () => {
      const lines = parse(`
a: ds.w 1
      BSS
b: ds.w 1
      DATA
c: ds.w 1
      SECTION "foo",BSS
d: ds.w 1

`);
      expect(lines[1].bss).toBe(false);
      expect(lines[3].bss).toBe(true);
      expect(lines[5].bss).toBe(false);
      expect(lines[7].bss).toBe(true);
    });
  });

  describe("parse assignments", () => {
    test("zero assignments replace previous values", () => {
      const lines = parse("count=4\ncount=0\n ds.w count");
      expect(lines[2].bytes).toBe(0);
    });

    test("assignment expressions use vasm precedence", () => {
      const lines = parse("count=1+2<<3\n ds.w count");
      expect(lines[1].bytes).toBe(34);
    });

    test("dynamic shift", () => {
      const code = `
foo=4
      lsl.w #foo,d0
      `;
      const lines = parse(code);
      const n = 4;
      expect(lines[2].timing.values).toEqual([[6 + 2 * n, 1, 0]]);
    });

    test("forward ref", () => {
      const code = `
      lsl.w #foo,d0
foo=4
      `;
      const lines = parse(code);
      const n = 4;
      expect(lines[1].timing.values).toEqual([[6 + 2 * n, 1, 0]]);
    });
  });

  describe("no instruction", () => {
    test("empty line", () => {
      const [result] = parse("");
      expect(result.statement.comment).toBeFalsy();
      expect(result.statement.label).toBeFalsy();
      expect(result.statement.opcode).toBeFalsy();
    });

    test("only whitespace", () => {
      const [result] = parse("       ");
      expect(result.statement.comment).toBeFalsy();
      expect(result.statement.label).toBeFalsy();
      expect(result.statement.opcode).toBeFalsy();
    });

    test("only comment", () => {
      const [result] = parse("; foo bar baz");
      expect(result.statement.comment.text).toEqual("; foo bar baz");
      expect(result.statement.opcode).toBeFalsy();
    });

    test("only comment - alt", () => {
      const [result] = parse("* foo bar baz");
      expect(result.statement.comment.text).toEqual("* foo bar baz");
      expect(result.statement.opcode).toBeFalsy();
    });

    test("only label", () => {
      const [result] = parse("foo:");
      expect(result.statement.label.text).toEqual("foo");
      expect(result.statement.opcode).toBeFalsy();
    });

    test("only label - local", () => {
      const [result] = parse(".foo:");
      expect(result.statement.label.text).toEqual(".foo");
      expect(result.statement.opcode).toBeFalsy();
    });

    test("only label - no colon", () => {
      const [result] = parse("foo");
      expect(result.statement.label.text).toEqual("foo");
      expect(result.statement.opcode).toBeFalsy();
    });
  });
});
