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
