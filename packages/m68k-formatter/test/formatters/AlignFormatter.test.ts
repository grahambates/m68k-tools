import AlignFormatter, {
  type AlignOptions,
} from "../../src/formatter/formatters/AlignFormatter";
import { applyEdits, formatContext } from "../helpers";

async function doFormat(src: string, options: AlignOptions) {
  const formatter = new AlignFormatter(options);
  const edits = formatter.format(formatContext(src));
  return applyEdits(src, edits);
}

describe("AlignFormatter", () => {
  it.each(["line", "block", "file"] as const)(
    "indents mixed nested blocks with %s alignment and is idempotent",
    async (autoExtend) => {
      const src =
        "demo macro\n ifeq 1\n rept 2\nlocal: move.w d0,d1\n endr\n else\n nop\n endif\n endm\n rts";
      const options: AlignOptions = {
        mnemonic: 8,
        operands: 16,
        autoExtend,
        indentMacro: 2,
        indentConditional: 4,
        indentRept: 6,
      };
      const result = await doFormat(src, options);
      expect(result).toBe(
        [
          "demo    macro",
          "          ifeq    1",
          "              rept    2",
          "local:              move.w  d0,d1",
          "              endr",
          "          else",
          "              nop",
          "          endif",
          "        endm",
          "        rts",
        ].join("\n"),
      );
      expect(await doFormat(result, options)).toBe(result);
    },
  );

  it.each([
    [" ifeq 1", " endif", "indentConditional"],
    [" rept 2", " endr", "indentRept"],
    ["demo macro", " endm", "indentMacro"],
  ])("independently enables indentation for %s", async (start, end, option) => {
    const src = [start, " nop", end, " rts"].join("\n");
    const result = await doFormat(src, {
      mnemonic: 8,
      [option]: 8,
      indentStyle: "tab",
    });
    expect(result.split("\n").slice(1)).toEqual([
      "\t\tnop",
      "\t" + end.trim(),
      "\trts",
    ]);
    expect((await doFormat(src, { mnemonic: 8 })).split("\n")[1]).toBe(
      "        nop",
    );
  });

  it("indents an unfinished block and ignores unmatched terminators", async () => {
    const result = await doFormat(" endif\n ifeq 1\n nop", {
      mnemonic: 8,
      operands: 16,
      indentConditional: 4,
    });
    expect(result).toBe("        endif\n        ifeq    1\n            nop");
  });

  it("formats an instruction", async () => {
    const result = await doFormat(`foo:  move d1,d2`, {
      mnemonic: 10,
      operands: 20,
      comment: 35,
    });
    expect(result).toBe("foo:      move      d1,d2");
  });

  it("formats an instruction with a comment", async () => {
    const result = await doFormat(`foo:  move d1,d2; foo`, {
      mnemonic: 10,
      operands: 20,
      comment: 35,
    });
    expect(result).toBe("foo:      move      d1,d2          ; foo");
  });

  it("formats an instruction with no operands", async () => {
    const result = await doFormat(`  rts ; foo`, {
      mnemonic: 10,
      operands: 20,
      comment: 35,
    });
    expect(result).toBe("          rts                      ; foo");
  });

  it("handles a comment at start of line", async () => {
    const result = await doFormat(`; foo`, {
      mnemonic: 10,
      operands: 20,
      comment: 35,
    });
    expect(result).toBe("; foo");
  });

  it("positions a stand-alone comment at nearest position", async () => {
    const result = await doFormat(
      `
  ; foo
          move.w    d0,d1     ; comment
        ; foo
          move.w    d0,d1     ; comment
            ; foo
          move.w    d0,d1     ; comment
                  ; foo
          move.w    d0,d1     ; comment
                      ; foo
          move.w    d0,d1     ; comment
                           ; foo
          move.w    d0,d1     ; comment
                                 ; foo
          move.w    d0,d1     ; comment`,
      {
        mnemonic: 10,
        operands: 20,
        comment: 30,
        standaloneComment: "nearest",
      },
    );
    expect(result).toBe(`
; foo
          move.w    d0,d1     ; comment
          ; foo
          move.w    d0,d1     ; comment
          ; foo
          move.w    d0,d1     ; comment
                    ; foo
          move.w    d0,d1     ; comment
                    ; foo
          move.w    d0,d1     ; comment
                              ; foo
          move.w    d0,d1     ; comment
                              ; foo
          move.w    d0,d1     ; comment`);
  });

  it("positions a stand-alone comment at a named position", async () => {
    const result = await doFormat(
      `
  ; foo
          move.w    d0,d1     ; comment
                                 ; foo
          move.w    d0,d1     ; comment`,
      {
        mnemonic: 10,
        operands: 20,
        comment: 30,
        standaloneComment: "mnemonic",
      },
    );
    expect(result).toBe(`
          ; foo
          move.w    d0,d1     ; comment
          ; foo
          move.w    d0,d1     ; comment`);
  });

  it("positions a stand-alone comment at a numeric position", async () => {
    const result = await doFormat(
      `
  ; foo
          move.w    d0,d1     ; comment
                                 ; foo
          move.w    d0,d1     ; comment`,
      {
        mnemonic: 10,
        operands: 20,
        comment: 30,
        standaloneComment: 10,
      },
    );
    expect(result).toBe(`
          ; foo
          move.w    d0,d1     ; comment
          ; foo
          move.w    d0,d1     ; comment`);
  });

  it("inserts a minimum of one space", async () => {
    const result = await doFormat(`foobar:  move d1,d2`, {
      mnemonic: 4,
      operands: 20,
      comment: 35,
    });
    expect(result).toBe("foobar: move        d1,d2");
  });

  it("inserts a minimum of one space", async () => {
    const result = await doFormat(`foobar:  move   d1,d2       ; foo`, {
      mnemonic: 0,
      operands: 0,
      comment: 0,
    });
    expect(result).toBe("foobar: move d1,d2 ; foo");
  });

  it("always uses spaces for min indent", async () => {
    const result = await doFormat(`foobar:  move d1,d2`, {
      mnemonic: 0,
      operands: 0,
      comment: 0,
      indentStyle: "tab",
    });
    expect(result).toBe("foobar: move d1,d2");
  });

  it("formats an instruction with tabs", async () => {
    const result = await doFormat(`foobarbaz: move d1,d2; foo`, {
      mnemonic: 2 * 8,
      operands: 4 * 8,
      comment: 6 * 8,
      indentStyle: "tab",
      tabSize: 8,
    });
    expect(result).toBe(`foobarbaz:\tmove\t\td1,d2\t\t; foo`);
  });

  it("formats a constant assignment without indent by default", async () => {
    const result = await doFormat(`foobarbaz        =     123`, {
      mnemonic: 2,
      operands: 4,
      comment: 6,
    });
    expect(result).toBe("foobarbaz = 123");
  });

  describe("autoExtend file", () => {
    it("uses desired position if possible", async () => {
      const result = await doFormat(`label: move.w d0,d1 ; comment`, {
        mnemonic: 12,
        operands: 24,
        comment: 32,
        autoExtend: "file",
      });
      expect(result).toBe("label:      move.w      d0,d1   ; comment");
    });

    it("adjusts mnemonic position", async () => {
      const result = await doFormat(
        `
reallyreallylonglabel: rts
label: rts`,
        {
          mnemonic: 12,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
reallyreallylonglabel: rts
label:                 rts`,
      );
    });

    it("isn't affected by stand-alone labels", async () => {
      const result = await doFormat(
        `
reallyreallylonglabel:
  rts
label: rts`,
        {
          mnemonic: 12,
          operands: 24,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
reallyreallylonglabel:
            rts
label:      rts`,
      );
    });

    it("adjusts operands position for mnemonic overflow", async () => {
      const result = await doFormat(
        `
label: reallylongmnemonic d0,d1
label: move.w d0,d1`,
        {
          mnemonic: 12,
          operands: 24,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
label:      reallylongmnemonic d0,d1
label:      move.w             d0,d1`,
      );
    });

    it("adjusts operands position for label overflow", async () => {
      const result = await doFormat(
        `
reallyreallylonglabel: reallylongmnemonic d0,d1
label: move.w d0,d1`,
        {
          mnemonic: 12,
          operands: 24,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
reallyreallylonglabel: reallylongmnemonic d0,d1
label:                 move.w             d0,d1`,
      );
    });

    it("adjusts operator position for label overflow", async () => {
      const result = await doFormat(
        `
foo = 1
reallyreallylonglabel = 2`,
        {
          operator: 12,
          value: 0,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
foo                   = 1
reallyreallylonglabel = 2`,
      );
    });

    it("adjusts comment position for operands overflow", async () => {
      const result = await doFormat(
        `
label: move.w #reallylongeroperand,d1 ; comment
label: move.w d0,d1 ; comment`,
        {
          mnemonic: 12,
          operands: 24,
          comment: 32,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
label:      move.w      #reallylongeroperand,d1 ; comment
label:      move.w      d0,d1                   ; comment`,
      );
    });

    it("adjusts comment position for mnemonic overflow", async () => {
      const result = await doFormat(
        `
label: reallylongmnemonic #reallylongeroperand,d1 ; comment
label: move.w d0,d1 ; comment`,
        {
          mnemonic: 12,
          operands: 24,
          comment: 32,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
label:      reallylongmnemonic #reallylongeroperand,d1 ; comment
label:      move.w             d0,d1                   ; comment`,
      );
    });

    it("adjusts comment position for mnemonic with no operands", async () => {
      const result = await doFormat(
        `
label: reallyreallyreallylongmnemonic ; comment
label: move.w d0,d1 ; comment`,
        {
          mnemonic: 12,
          operands: 24,
          comment: 32,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
label:      reallyreallyreallylongmnemonic ; comment
label:      move.w      d0,d1              ; comment`,
      );
    });

    it("adjusts comment position for label with no mnemonic", async () => {
      const result = await doFormat(
        `
reallyreallyreallyreallyreallyreallylonglabel ; comment
label: move.w d0,d1 ; comment`,
        {
          mnemonic: 12,
          operands: 24,
          comment: 32,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
reallyreallyreallyreallyreallyreallylonglabel ; comment
label:      move.w      d0,d1                 ; comment`,
      );
    });

    it("adjusts comment position for label operator / value", async () => {
      const result = await doFormat(
        `
reallyreallyreallyreallyreallyreallylonglabel = 1; comment
label: move.w d0,d1 ; comment`,
        {
          mnemonic: 12,
          operands: 24,
          comment: 32,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
reallyreallyreallyreallyreallyreallylonglabel = 1 ; comment
label:      move.w      d0,d1                     ; comment`,
      );
    });

    it("adjusts position with tabs", async () => {
      const result = await doFormat(
        `
reallyreallylonglabel: rts
label: rts`,
        {
          mnemonic: 3 * 8,
          indentStyle: "tab",
          tabSize: 8,
          autoExtend: "file",
        },
      );
      expect(result).toBe(
        `
reallyreallylonglabel:\trts
label:\t\t\trts`,
      );
    });
  });

  describe("autoExtend block", () => {
    it("limits adjustments to blocks separated by multiple line breaks", async () => {
      const result = await doFormat(
        `
label: reallylongmnemonic d0,d1
label: move.w d0,d1

label: move.w d0,d1 ; comment`,
        {
          mnemonic: 12,
          operands: 24,
          comment: 32,
          autoExtend: "block",
        },
      );
      expect(result).toBe(
        `
label:      reallylongmnemonic d0,d1
label:      move.w             d0,d1

label:      move.w      d0,d1   ; comment`,
      );
    });
  });

  it("ignores text inside REM", async () => {
    const result = await doFormat(
      `
foo:  move d1,d2
  REM
Lorem ipsum dolor sit amet,
consectetur adipiscing elit.
Curabitur aliquet non velit sit amet condimentum.
  EREM
foo:  move d1,d2
`,
      {
        mnemonic: 10,
        operands: 20,
        comment: 35,
      },
    );
    expect(result).toBe(`
foo:      move      d1,d2
          REM
Lorem ipsum dolor sit amet,
consectetur adipiscing elit.
Curabitur aliquet non velit sit amet condimentum.
          EREM
foo:      move      d1,d2
`);
  });

  it("ignores text after END", async () => {
    const result = await doFormat(
      `
foo:  move d1,d2
  END
Lorem ipsum dolor sit amet,
consectetur adipiscing elit.
Curabitur aliquet non velit sit amet condimentum.
`,
      {
        mnemonic: 10,
        operands: 20,
        comment: 35,
      },
    );
    expect(result).toBe(`
foo:      move      d1,d2
          END
Lorem ipsum dolor sit amet,
consectetur adipiscing elit.
Curabitur aliquet non velit sit amet condimentum.
`);
  });

  it("formats handles quoted marco arguments", async () => {
    const result = await doFormat(` FOO <1,"foo">,d2`, {
      mnemonic: 10,
      operands: 20,
      comment: 35,
    });
    expect(result).toBe('          FOO       <1,"foo">,d2');
  });
});
