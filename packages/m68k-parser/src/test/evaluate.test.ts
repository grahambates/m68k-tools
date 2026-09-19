import { evaluateConstant, parseExpression } from "../index.js";

// vasm manual, Expressions: unary, shifts, AND, XOR, OR, multiply,
// add, comparison, equality, logical AND, logical OR (highest first).
// https://github.com/StarWolf3000/vasm-mirror/blob/master/doc/vasm_main.texi
// Expected values also verified with the bundled vasm 1.9 mot assembler.
const examples: [string, number][] = [
  ["1+2<<3", 17],
  ["2*3|1", 6],
  ["1|2^3&1", 3],
  ["8>>1+1", 5],
  ["20/3/2", 3],
  ["-7/2", -3],
  ["7//3", 1],
  ["11%4", 3],
  ["12 ~ 8", 4],
  ["2 ! 4", 6],
  ["~1", -2],
  ["!0", 1],
  ["1=1", -1],
  ["1||0", -1],
  ["0&&2", 0],
  ["$ff+@10+%10", 265],
  ["(1+2)<<3", 24],
  ["1+2=3&&4>2", -1],
];

test.each(examples)("evaluates %s with vasm precedence", (source, value) => {
  const parsed = parseExpression(source);
  expect(parsed.errors).toEqual([]);
  expect(evaluateConstant(parsed.value)).toEqual({ known: true, value });
});

test.each(["1 2", "1)", "1+", "(1", ""])(
  "does not evaluate malformed input %s as a valid constant",
  (source) => {
    const parsed = parseExpression(source);
    expect(
      parsed.errors.length > 0 || !evaluateConstant(parsed.value).known,
    ).toBe(true);
  },
);

test("resolves zero and preserves unknown results", () => {
  expect(evaluateConstant(parseExpression("count+1").value, () => 0)).toEqual({
    known: true,
    value: 1,
  });
  expect(evaluateConstant(parseExpression("missing").value)).toEqual({
    known: false,
    reason: "unknown-symbol",
  });
  expect(evaluateConstant(parseExpression("1/0").value)).toEqual({
    known: false,
    reason: "division-by-zero",
  });
});

// Values are 32-bit signed, as vasm has them: every expected value below is
// what vasm (mot syntax, native build) assembled for `dc.l <expression>`.
const wrapped: [string, number][] = [
  ["$ffffffff", -1],
  ["$ffffffff=-1", -1],
  ["$ffffffff<5", -1],
  ["$80000000", -2147483648],
  ["$80000000<0", -1],
  ["$7fffffff+1", -2147483648],
  ["65536*65536", 0],
  ["65536*65536=0", -1],
  ["$7fffffff*2", -2],
  ["$ffffffff/-5", 0],
  ["4294967295", -1],
  ["$ffff0000>>16", -1],
  ["1<<31", -2147483648],
  // Shift counts are taken modulo 32.
  ["1<<32", 1],
  ["65536>>33", 32768],
  ["65536>>1000", 256],
  ["1<<-1", -2147483648],
];

test.each(wrapped)("wraps %s to 32 bits", (source, value) => {
  const parsed = parseExpression(source);
  expect(parsed.errors).toEqual([]);
  expect(evaluateConstant(parsed.value)).toEqual({ known: true, value });
});

// A character constant is up to four characters, packed big-endian; verified
// with vasm as above.
const characters: [string, number][] = [
  ["'A'", 65],
  ['"A"', 65],
  ["'AB'", 0x4142],
  ["'ABCD'", 0x41424344],
  ["''", 0],
  ["'a'-'A'", 32],
  ["'A'+1", 66],
  ["'A'<<8", 0x4100],
];

test.each(characters)(
  "evaluates the character constant %s",
  (source, value) => {
    const parsed = parseExpression(source);
    expect(parsed.errors).toEqual([]);
    expect(evaluateConstant(parsed.value)).toEqual({ known: true, value });
  },
);

test("a string too long for a constant is not one", () => {
  const parsed = parseExpression("'ABCDE'");
  expect(evaluateConstant(parsed.value).known).toBe(false);
});

test("a character constant reads escapes only when the assembler does", () => {
  const parsed = parseExpression("'a\\n'");
  // Three characters as written, and two with -esc: verified with vasm.
  expect(evaluateConstant(parsed.value)).toEqual({
    known: true,
    value: 0x615c6e,
  });
  expect(
    evaluateConstant(parsed.value, undefined, { escapeSequences: true }),
  ).toEqual({ known: true, value: 0x610a });
});
