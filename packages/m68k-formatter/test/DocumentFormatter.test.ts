import DocumentFormatter, {
  type FormatterOptions,
} from "../src/formatter/DocumentFormatter";
import { applyEdits, formatContext } from "./helpers";

async function doFormat(src: string, options: FormatterOptions) {
  const formatter = new DocumentFormatter(options);
  const edits = formatter.format(formatContext(src));
  return applyEdits(src, edits);
}

describe("DocumentFormatter", () => {
  it("formats a document", async () => {
    const src = `
label
foo:    MOVE.W D0,D1 ; example
; comment
`;

    const result = await doFormat(src, {
      case: "lower",
      labelColon: "on",
      align: {
        mnemonic: 10,
        operands: 20,
        comment: 35,
      },
    });

    expect(result).toBe(`
label:
foo:      move.w    d0,d1          ; example
; comment
`);
  });

  it("accounts for added colons in alignment", async () => {
    const src = `
foo     MOVE.W D0,D1 ; example
bar:    MOVE.W D0,D1 ; example
`;

    const result = await doFormat(src, {
      case: "lower",
      labelColon: "on",
      align: {
        mnemonic: 10,
        operands: 20,
        comment: 35,
      },
    });

    expect(result).toBe(`
foo:      move.w    d0,d1          ; example
bar:      move.w    d0,d1          ; example
`);
  });

  it("applies quotes, operand spacing, trailing whitespace and line ending together", async () => {
    const src = " move.w\td0,  d1  \r\n dc.b\t'hello'\r\n";

    const result = await doFormat(src, {
      quotes: "double",
      operandSpace: "off",
      trimWhitespace: true,
      endOfLine: "lf",
    });

    expect(result).toBe(' move.w\td0,d1\n dc.b\t"hello"\n');
  });

  describe("#formatRange()", () => {
    async function doFormatRange(
      src: string,
      options: FormatterOptions,
      range: { start: [number, number]; end: [number, number] },
    ) {
      const formatter = new DocumentFormatter(options);
      const edits = formatter.formatRange(formatContext(src), {
        start: { line: range.start[0], character: range.start[1] },
        end: { line: range.end[0], character: range.end[1] },
      });
      return applyEdits(src, edits);
    }

    it("uses enclosing blocks outside the selected range", async () => {
      const src = " ifeq 1\n MOVE.W D0,D1\n endif";
      const result = await doFormatRange(
        src,
        {
          case: "lower",
          align: { mnemonic: 8, operands: 16, indentConditional: 4 },
        },
        { start: [1, 0], end: [1, 100] },
      );
      expect(result).toBe(" ifeq 1\n            move.w  d0,d1\n endif");
    });

    const src = " MOVE.W D0,D1\n ADD.W D0,D1\n SUB.W D0,D1";

    it("only formats lines within the requested range", async () => {
      const result = await doFormatRange(
        src,
        { case: "lower" },
        { start: [1, 0], end: [1, 100] },
      );

      expect(result).toBe(" MOVE.W D0,D1\n add.w d0,d1\n SUB.W D0,D1");
    });

    it("formats every line when the range spans the whole document", async () => {
      const result = await doFormatRange(
        src,
        { case: "lower" },
        { start: [0, 0], end: [2, 100] },
      );

      expect(result).toBe(" move.w d0,d1\n add.w d0,d1\n sub.w d0,d1");
    });

    it("excludes an edit that extends past the end of the range", async () => {
      // The mnemonic on line 0 spans columns 1-7; a range ending at column 3
      // does not fully contain it, so it should be left alone.
      const result = await doFormatRange(
        src,
        { case: "lower" },
        { start: [0, 0], end: [0, 3] },
      );

      expect(result).toBe(src);
    });

    it("returns no edits for a range with nothing to format", async () => {
      const result = await doFormatRange(
        " move.w d0,d1",
        { case: "lower" },
        { start: [0, 0], end: [0, 13] },
      );

      expect(result).toBe(" move.w d0,d1");
    });
  });
});
