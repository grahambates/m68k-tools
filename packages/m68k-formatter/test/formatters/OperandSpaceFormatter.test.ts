import OperandSpaceFormatter, {
  type OperandSpaceOptions,
} from "../../src/formatter/formatters/OperandSpaceFormatter";
import { applyEdits, formatContext } from "../helpers";

async function doFormat(src: string, options: OperandSpaceOptions) {
  const formatter = new OperandSpaceFormatter(options);
  const edits = formatter.format(formatContext(src));
  return applyEdits(src, edits);
}

describe("OperandSpaceFormatter", () => {
  describe("on", () => {
    it("adds a space after a tight comma", async () => {
      const result = await doFormat(" move.w d0,d1", "on");
      expect(result).toBe(" move.w d0, d1");
    });

    it("normalises multiple extra spaces to one", async () => {
      const result = await doFormat(" move.w d0,   d1", "on");
      expect(result).toBe(" move.w d0, d1");
    });

    it("leaves an already-spaced comma alone", async () => {
      const result = await doFormat(" move.w d0, d1", "on");
      expect(result).toBe(" move.w d0, d1");
    });

    it("spaces every separator in a longer operand list", async () => {
      const result = await doFormat(" dc.w 1,2,3,4", "on");
      expect(result).toBe(" dc.w 1, 2, 3, 4");
    });

    it("does not touch a comma inside a single operand", async () => {
      // The register list is one operand; only the top-level separator
      // between operands should be touched.
      const result = await doFormat(" movem.l d0-d7/a0-a6,-(sp)", "on");
      expect(result).toBe(" movem.l d0-d7/a0-a6, -(sp)");
    });

    it("does nothing for a single-operand line", async () => {
      const result = await doFormat(" clr.w d0", "on");
      expect(result).toBe(" clr.w d0");
    });

    it("does nothing for a no-operand line", async () => {
      const result = await doFormat(" rts", "on");
      expect(result).toBe(" rts");
    });

    it("formats every line in a multi-line document", async () => {
      const src = " move.w d0,d1\n dc.w 1,2\n rts";
      const result = await doFormat(src, "on");
      expect(result).toBe(" move.w d0, d1\n dc.w 1, 2\n rts");
    });
  });

  describe("off", () => {
    it("removes a space after a comma", async () => {
      const result = await doFormat(" move.w d0, d1", "off");
      expect(result).toBe(" move.w d0,d1");
    });

    it("collapses multiple extra spaces", async () => {
      const result = await doFormat(" move.w d0,   d1", "off");
      expect(result).toBe(" move.w d0,d1");
    });

    it("leaves an already-tight comma alone", async () => {
      const result = await doFormat(" move.w d0,d1", "off");
      expect(result).toBe(" move.w d0,d1");
    });

    it("removes spacing from every separator in a longer list", async () => {
      const result = await doFormat(" dc.w 1, 2, 3, 4", "off");
      expect(result).toBe(" dc.w 1,2,3,4");
    });
  });

  describe("any", () => {
    it("makes no changes when spaced", async () => {
      const result = await doFormat(" move.w d0, d1", "any");
      expect(result).toBe(" move.w d0, d1");
    });

    it("makes no changes when tight", async () => {
      const result = await doFormat(" move.w d0,d1", "any");
      expect(result).toBe(" move.w d0,d1");
    });

    it("makes no changes to inconsistent spacing", async () => {
      const result = await doFormat(" dc.w 1,2,  3,4", "any");
      expect(result).toBe(" dc.w 1,2,  3,4");
    });
  });
});
