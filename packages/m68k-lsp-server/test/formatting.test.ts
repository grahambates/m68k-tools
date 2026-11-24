import * as formatting from "../src/formatting";

describe("formatting", () => {
  describe("#formatDeclaration()", () => {
    it("formats a declaration", async () => {
      const formatted = formatting.formatDeclaration("    xref foo  ; example");
      expect(formatted).toEqual(" xref foo");
    });
  });

  describe("#asciiValue()", () => {
    it("returns the ascii character", async () => {
      const ascii = formatting.asciiValue(60);
      expect(ascii).toEqual("<");
    });
  });

  describe("#formatNumeric()", () => {
    it("formats a number", async () => {
      const ascii = formatting.formatNumeric("20");
      expect(ascii).toEqual('20 | $14 | %10100 | @24 | "."');
    });
  });

  describe("#formatNumber()", () => {
    it("writes hexadecimal in upper case", () => {
      expect(formatting.formatNumber(0xdff096)).toEqual(
        '14676118 | $DFF096 | %110111111111000010010110 | @67770226 | "ßð."',
      );
    });

    it("shows a negative value's 32-bit pattern in the other bases", () => {
      expect(formatting.formatNumber(-1)).toEqual(
        '-1 | $FFFFFFFF | %11111111111111111111111111111111 | @37777777777 | "ÿÿÿÿ"',
      );
    });

    it("shows four bytes as characters", () => {
      expect(formatting.formatNumber(0x494c424d)).toContain('"ILBM"');
    });

    it("escapes characters Markdown would read", () => {
      // "*_" would otherwise start emphasis.
      expect(formatting.formatNumber(0x2a5f)).toContain('"\\*\\_"');
    });
  });
});
