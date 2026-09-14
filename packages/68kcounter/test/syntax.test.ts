import { Cpus, isMnemonic, isQualifier, toCpu } from "../src/syntax";

describe("isMnemonic()", () => {
  test("valid", () => {
    expect(isMnemonic("MOVE")).toBeTruthy();
  });
  test("invalid", () => {
    expect(isMnemonic("FOO")).toBeFalsy();
  });
});

describe("isQualifier()", () => {
  test("valid", () => {
    expect(isQualifier("B")).toBeTruthy();
    expect(isQualifier("W")).toBeTruthy();
    expect(isQualifier("L")).toBeTruthy();
  });
  test("invalid", () => {
    expect(isMnemonic("X")).toBeFalsy();
  });
});

describe("toCpu()", () => {
  test("bare model numbers", () => {
    expect(toCpu("68000")).toEqual(Cpus.MC68000);
    expect(toCpu("68020")).toEqual(Cpus.MC68020);
    expect(toCpu("68030")).toBe(Cpus.MC68030);
  });
  test("mc-prefixed directive forms", () => {
    expect(toCpu("mc68000")).toEqual(Cpus.MC68000);
    expect(toCpu("MC68020")).toEqual(Cpus.MC68020);
  });
  test("unsupported / non-cpu values", () => {
    expect(toCpu("68040")).toBeUndefined();
    expect(toCpu("MOVE")).toBeUndefined();
  });
});
