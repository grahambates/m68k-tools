import {
  containsPosition,
  containsRange,
  isBeforeOrEqual,
  locationAsRange,
} from "../geometry.js";

const range = (a: number, b: number, c: number, d: number) => ({
  start: { line: a, character: b },
  end: { line: c, character: d },
});

describe("geometry", () => {
  it("converts a one-based location to a zero-based range", () => {
    expect(locationAsRange({ start: 2, end: 5, line: 3 })).toEqual(
      range(2, 2, 2, 5),
    );
  });

  it("takes an explicit line for a location without one", () => {
    expect(locationAsRange({ start: 1, end: 4 }, 7)).toEqual(range(7, 1, 7, 4));
    expect(locationAsRange({ start: 1, end: 4 })).toEqual(range(0, 1, 0, 4));
  });

  it("orders positions", () => {
    expect(
      isBeforeOrEqual({ line: 1, character: 5 }, { line: 2, character: 0 }),
    ).toBe(true);
    expect(
      isBeforeOrEqual({ line: 2, character: 1 }, { line: 2, character: 0 }),
    ).toBe(false);
  });

  it("contains positions and ranges inclusively", () => {
    const outer = range(1, 0, 3, 10);
    expect(containsPosition(outer, { line: 3, character: 10 })).toBe(true);
    expect(containsPosition(outer, { line: 4, character: 0 })).toBe(false);
    expect(containsRange(outer, range(2, 0, 2, 5))).toBe(true);
    expect(containsRange(outer, range(2, 0, 4, 0))).toBe(false);
  });
});
