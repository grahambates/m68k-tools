import CaseFormatter, {
  type CaseOptions,
} from "../../src/formatter/formatters/CaseFormatter";
import { applyEdits, formatContext } from "../helpers";

async function doFormat(src: string, options: CaseOptions) {
  const formatter = new CaseFormatter(options);
  const edits = formatter.format(formatContext(src));
  return applyEdits(src, edits);
}

describe("CaseFormatter", () => {
  it("converts instruction to lower case", async () => {
    const result = await doFormat(` MOVE d0,d1`, { instruction: "lower" });
    expect(result).toBe(" move d0,d1");
  });

  it("converts instruction to upper case", async () => {
    const result = await doFormat(` move d0,d1`, { instruction: "upper" });
    expect(result).toBe(" MOVE d0,d1");
  });

  it("includes size", async () => {
    const result = await doFormat(` MOVE.W d0,d1`, { instruction: "lower" });
    expect(result).toBe(" move.w d0,d1");
  });

  it("converts registers to lower case", async () => {
    const result = await doFormat(` move.w D0,A1`, { register: "lower" });
    expect(result).toBe(" move.w d0,a1");
  });

  it("converts directives to lower case", async () => {
    const result = await doFormat(` DC.W $123`, { directive: "lower" });
    expect(result).toBe(" dc.w $123");
  });

  it("converts control directives to lower case", async () => {
    const result = await doFormat(` IFEQ $123`, { control: "lower" });
    expect(result).toBe(" ifeq $123");
  });

  it("converts control directives to lower case", async () => {
    const result = await doFormat(` section foo,BSS`, { sectionType: "lower" });
    expect(result).toBe(" section foo,bss");
  });

  it("converts hex literals to lower case", async () => {
    const result = await doFormat(` dc.w $AB12`, { hex: "lower" });
    expect(result).toBe(" dc.w $ab12");
  });

  it("converts control directives independently of other directives", async () => {
    // m68k-parser calls both of these directives; the formatter keeps them
    // apart so `control` and `directive` can differ.
    const result = await doFormat(` IFEQ $123\n DC.W 1\n ENDC`, {
      control: "lower",
      directive: "upper",
    });
    expect(result).toBe(" ifeq $123\n DC.W 1\n endc");
  });

  it("converts a section type given as the only operand", async () => {
    // With one operand the parser cannot tell a section type from a section
    // name, so this path does not get a section-type node.
    const result = await doFormat(` section BSS`, { sectionType: "lower" });
    expect(result).toBe(" section bss");
  });

  it("leaves a section name alone when it is not a section type", async () => {
    const result = await doFormat(` section MyChunk`, { sectionType: "lower" });
    expect(result).toBe(" section MyChunk");
  });

  it("converts fpu registers", async () => {
    const result = await doFormat(` fmove FP0,FP1`, { register: "lower" });
    expect(result).toBe(" fmove fp0,fp1");
  });
});
