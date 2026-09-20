import { parseLine } from "../line-parser.js";

/** `iif` makes the statement after its condition conditional; the condition ends at the first blank, as in vasm. */
describe("iif", () => {
  const parse = (text: string) => parseLine(text).value;

  it("keeps the statement it makes conditional, in place", () => {
    const text = "\tiif DEBUG move.w d0,d1";
    const line = parse(text);
    const inner = line.inlineStatement!;
    expect(inner.mnemonic).toMatchObject({
      type: "instruction",
      instruction: "move",
    });
    expect(inner.qualifier).toMatchObject({ type: "size", size: "w" });
    expect(inner.operands).toHaveLength(2);
    // Its locations are locations in the whole line.
    expect(text.slice(inner.mnemonic!.loc.start, inner.mnemonic!.loc.end)).toBe(
      "move",
    );
    const last = inner.operands![1].loc;
    expect(text.slice(last.start, last.end)).toBe("d1");
  });

  it("takes an instruction with no operands", () => {
    const line = parse("\tiif 1 nop");
    expect(line.inlineStatement?.mnemonic).toMatchObject({
      type: "instruction",
      instruction: "nop",
    });
  });

  it("takes a data directive", () => {
    const line = parse("\tiif 1 dc.b 1,2");
    expect(line.inlineStatement?.mnemonic).toMatchObject({
      type: "directive",
      directive: "dc",
    });
    expect(line.inlineStatement?.operands).toHaveLength(2);
  });

  it("leaves a comment out of the statement", () => {
    const line = parse("\tiif 1 nop ; keep");
    expect(line.inlineStatement?.mnemonic).toMatchObject({
      instruction: "nop",
    });
    expect(line.inlineStatement?.operands).toBeUndefined();
  });

  it("still has the condition and a copy of the operands", () => {
    const line = parse("\tiif x=1 moveq #1,d0");
    expect(line.inlineCondition?.type).toBe("binary-op");
    expect(line.operands).toEqual(line.inlineStatement?.operands);
  });

  it("ends the condition at the first blank", () => {
    // vasm reads `iif 1 = 1 nop` as the condition 1 and the statement `= 1 nop`.
    const line = parse("\tiif 1 = 1 nop");
    expect(line.inlineCondition).toMatchObject({ type: "numeric-literal" });
    expect(line.inlineStatement?.mnemonic?.type).not.toBe("instruction");
  });

  it("belongs to a line with a label", () => {
    const line = parse("lbl\tiif 1 nop");
    expect(line.label?.label).toBe("lbl");
    expect(line.inlineStatement?.mnemonic).toMatchObject({
      instruction: "nop",
    });
  });
});
