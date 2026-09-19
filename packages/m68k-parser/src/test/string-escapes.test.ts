import { decodeStringEscapes } from "../string-escapes.js";
import { directiveSize } from "../directive-size.js";
import { evaluateConstant } from "../evaluate.js";
import { parseLine } from "../line-parser.js";

/**
 * Expected values were taken from vasm's own output for `dc.b "a<seq>"` with
 * `-esc`, so the sequences and the sizes are what it assembles.
 */
const decode = (text: string) => decodeStringEscapes(text).elements;

describe("decodeStringEscapes", () => {
  test.each([
    ["\\n", 0x0a],
    ["\\r", 0x0d],
    ["\\t", 0x09],
    ["\\b", 0x08],
    ["\\e", 0x1b],
    ["\\f", 0x0c],
    ["\\\\", 0x5c],
    ['\\"', 0x22],
    ["\\'", 0x27],
  ])("%s is one element", (sequence, value) => {
    expect(decode(`a${sequence}`)).toEqual([0x61, value]);
  });

  test("octal digits, up to three, weighted by eight and truncated to a byte", () => {
    expect(decode("a\\0")).toEqual([0x61, 0]);
    expect(decode("a\\101")).toEqual([0x61, 0x41]);
    expect(decode("a\\012")).toEqual([0x61, 0x0a]);
    expect(decode("a\\18")).toEqual([0x61, 0x10]);
    expect(decode("a\\400")).toEqual([0x61, 0]);
    expect(decode("a\\777")).toEqual([0x61, 0xff]);
    // A fourth digit is an ordinary character.
    expect(decode("a\\0000")).toEqual([0x61, 0, 0x30]);
    expect(decode("a\\0b")).toEqual([0x61, 0, 0x62]);
  });

  test("hex digits, up to two", () => {
    expect(decode("a\\x41")).toEqual([0x61, 0x41]);
    expect(decode("a\\XAB")).toEqual([0x61, 0xab]);
    expect(decode("a\\x4")).toEqual([0x61, 4]);
    expect(decode("a\\x123")).toEqual([0x61, 0x12, 0x33]);
    // No digits at all is a zero.
    expect(decode("a\\xZZ")).toEqual([0x61, 0, 0x5a, 0x5a]);
  });

  test("anything else is illegal and stays as written", () => {
    for (const sequence of ["\\a", "\\v", "\\z", "\\N", "\\ "]) {
      const { elements, illegal } = decodeStringEscapes(`a${sequence}`);
      expect(illegal).toEqual([sequence]);
      expect(elements).toHaveLength(3);
      expect(elements[1]).toBe(0x5c);
    }
  });

  test("a trailing backslash is just a character", () => {
    expect(decode("ab\\")).toEqual([0x61, 0x62, 0x5c]);
  });

  test("text with no escapes is unchanged", () => {
    expect(decode("Hello")).toEqual([...Buffer.from("Hello")]);
    expect(decodeStringEscapes("Hello").illegal).toEqual([]);
  });
});

describe("directiveSize with escape sequences", () => {
  const line = (text: string) => parseLine(text).value;

  test("a string is as long as written unless escapes are read", () => {
    expect(directiveSize(line('\tdc.b "a\\n"'))).toBe(3);
    expect(
      directiveSize(line('\tdc.b "a\\n"'), { escapeSequences: false }),
    ).toBe(3);
  });

  test("an escape is one element when they are", () => {
    const options = { escapeSequences: true };
    expect(directiveSize(line('\tdc.b "a\\n",0'), options)).toBe(3);
    expect(directiveSize(line('\tdc.w "a\\n"'), options)).toBe(4);
    expect(directiveSize(line('\tdc.b "\\x41\\101"'), options)).toBe(2);
  });
});

describe("a character constant in an operand", () => {
  const value = (text: string) => {
    const operand = parseLine(text).value.operands?.[0];
    const expr = operand?.type === "immediate" ? operand.value : undefined;
    return expr && evaluateConstant(expr);
  };

  test("takes the operators that follow it", () => {
    expect(value("\tmove.b #'A'+1,d0")).toEqual({ known: true, value: 66 });
    expect(value("\tmove.b #'a'-'A',d0")).toEqual({ known: true, value: 32 });
  });

  test("a doubled quote is one quote", () => {
    expect(value("\tmove.b #'''',d0")).toEqual({ known: true, value: 39 });
  });
});
