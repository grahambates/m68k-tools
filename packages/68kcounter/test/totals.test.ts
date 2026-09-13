import { type Line, StatementNode } from "../src/parse";
import { calculateTotals } from "../src/totals";

describe("calculateTotals", () => {
  const statement = new StatementNode(" move.w d0,d1");
  test("single timings", () => {
    const lines: Line[] = [
      { statement, timing: { values: [[4, 2, 1]], labels: [] }, bytes: 2 },
      { statement, timing: { values: [[8, 1, 0]], labels: [] }, bytes: 1 },
      { statement },
      { statement, timing: { values: [[12, 0, 1]], labels: [] }, bytes: 2 },
    ];
    const result = calculateTotals(lines);
    expect(result.isRange).toEqual(false);
    expect(result.min).toEqual([24, 3, 2]);
    expect(result.max).toEqual([24, 3, 2]);
    expect(result.bytes).toEqual(5);
  });

  test("excludes reference lines", () => {
    const lines: Line[] = [
      { statement, timing: { values: [[4, 2, 1]], labels: [] }, bytes: 2 },
      {
        statement,
        timing: { values: [[8, 1, 0]], labels: [] },
        bytes: 4,
        reference: true,
      },
      { statement, timing: { values: [[12, 0, 1]], labels: [] }, bytes: 2 },
    ];
    const result = calculateTotals(lines);
    expect(result.min).toEqual([16, 2, 2]);
    expect(result.bytes).toEqual(4);
  });

  test("range", () => {
    const lines: Line[] = [
      {
        statement,
        timing: {
          values: [
            [4, 2, 1],
            [6, 2, 1],
          ],
          labels: [],
        },
        bytes: 2,
      },
      { statement, timing: { values: [[8, 1, 0]], labels: [] }, bytes: 1 },
      { statement },
      { statement, timing: { values: [[12, 0, 1]], labels: [] }, bytes: 2 },
    ];
    const result = calculateTotals(lines);
    expect(result.isRange).toEqual(true);
    expect(result.min).toEqual([24, 3, 2]);
    expect(result.max).toEqual([26, 3, 2]);
    expect(result.bytes).toEqual(5);
  });
});
