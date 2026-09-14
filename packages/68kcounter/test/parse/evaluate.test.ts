import evaluate from "../../src/parse/evaluate";

describe("evaluate", () => {
  test("decimal", () => {
    expect(evaluate("3")).toEqual(3);
  });

  test("hex", () => {
    expect(evaluate("$ff")).toEqual(255);
  });

  test("octal", () => {
    expect(evaluate("@10")).toEqual(8);
  });

  test("binary", () => {
    expect(evaluate("%110")).toEqual(6);
  });

  test("addition", () => {
    expect(evaluate("$2+%10+2")).toEqual(6);
  });

  test("parens", () => {
    expect(evaluate("(3+1)*2")).toEqual(8);
  });

  test("vars", () => {
    expect(evaluate("x+y", { x: 1, y: 2 })).toEqual(3);
  });

  test("xor", () => {
    expect(evaluate("12^8")).toEqual(4);
    expect(evaluate("12~8")).toEqual(4);
  });

  test("or", () => {
    expect(evaluate("2|4")).toEqual(6);
    expect(evaluate("2!4")).toEqual(6);
  });

  test("modulo", () => {
    expect(evaluate("11%4")).toEqual(3);
  });

  test("not", () => {
    expect(evaluate("~1")).toEqual(-2);
  });
});

test.each([
  ["1+2<<3", 17],
  ["2*3|1", 6],
  ["7/2", 3],
  ["-7/2", -3],
  ["7//3", 1],
  ["  #$ff", 255],
  ["2 ! 4", 6],
  ["12 ~ 8", 4],
  ["1/0", undefined],
  ["1 2", undefined],
  ["constructor", undefined],
])("evaluates %s using assembler semantics", (source, expected) => {
  expect(evaluate(source)).toBe(expected);
});
