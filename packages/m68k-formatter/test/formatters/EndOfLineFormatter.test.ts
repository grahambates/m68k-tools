import EndOfLineFormatter, {
  type EOL,
} from "../../src/formatter/formatters/EndOfLineFormatter";
import { applyEdits, formatContext } from "../helpers";

async function doFormat(src: string, type: EOL, finalNewLine?: boolean) {
  const formatter = new EndOfLineFormatter(type, finalNewLine);
  const edits = formatter.format(formatContext(src));
  return applyEdits(src, edits);
}

describe("EndOfLineFormatter", () => {
  it("converts to crlf", async () => {
    const result = await doFormat(` move d1,d2\n add d2,d3`, "crlf");
    expect(result).toBe(" move d1,d2\r\n add d2,d3");
  });

  it("converts to cr", async () => {
    const result = await doFormat(` move d1,d2\n add d2,d3`, "cr");
    expect(result).toBe(" move d1,d2\r add d2,d3");
  });

  it("converts to lf", async () => {
    const result = await doFormat(` move d1,d2\r add d2,d3`, "lf");
    expect(result).toBe(" move d1,d2\n add d2,d3");
  });

  it("adds final new line", async () => {
    const result = await doFormat(` move d1,d2\n add d2,d3`, "lf", true);
    expect(result).toBe(" move d1,d2\n add d2,d3\n");
  });

  it("removes final new line", async () => {
    const result = await doFormat(` move d1,d2\r add d2,d3\r`, "lf", false);
    expect(result).toBe(" move d1,d2\n add d2,d3");
  });

  it("does nothing when already the target line ending", async () => {
    const result = await doFormat(` move d1,d2\n add d2,d3`, "lf");
    expect(result).toBe(" move d1,d2\n add d2,d3");
  });

  it("converts every line ending in a multi-line document", async () => {
    const result = await doFormat(`a\nb\nc\nd`, "crlf");
    expect(result).toBe("a\r\nb\r\nc\r\nd");
  });

  it("converts a line ending at the very start of the document", async () => {
    // The first match's index is 0, which is falsy in JS - a truthiness
    // check on it rather than an undefined check would silently skip
    // converting exactly this line ending.
    const result = await doFormat(`\n move d1,d2\n add d2,d3`, "crlf");
    expect(result).toBe("\r\n move d1,d2\r\n add d2,d3");
  });

  it("converts a leading blank line to lf", async () => {
    const result = await doFormat(`\r\n move d1,d2\n add d2,d3`, "lf");
    expect(result).toBe("\n move d1,d2\n add d2,d3");
  });

  it("does not add a final new line if one is already present", async () => {
    const result = await doFormat(` move d1,d2\n`, "lf", true);
    expect(result).toBe(" move d1,d2\n");
  });

  it("does not remove a final new line if there is none", async () => {
    const result = await doFormat(` move d1,d2`, "lf", false);
    expect(result).toBe(" move d1,d2");
  });

  it("converts line endings and adds a final new line together", async () => {
    const result = await doFormat(` move d1,d2\r add d2,d3`, "lf", true);
    expect(result).toBe(" move d1,d2\n add d2,d3\n");
  });

  it("converts line endings and removes a final new line together", async () => {
    const result = await doFormat(` move d1,d2\r add d2,d3\r`, "crlf", false);
    expect(result).toBe(" move d1,d2\r\n add d2,d3");
  });

  it("leaves the document alone when finalNewLine is undefined", async () => {
    const result = await doFormat(` move d1,d2\n`, "lf", undefined);
    expect(result).toBe(" move d1,d2\n");
  });
});
