import parse from "../../src/parse";

/** The bytes of the line after the source's last conditional, where a constant is used. */
const usedBytes = (source: string) => {
  const lines = parse(source);
  return lines[lines.length - 1].bytes;
};

describe("constants assigned in conditional blocks", () => {
  it("has no one value after arms that assign it differently", () => {
    const source = [
      "  IFNE DEBUG",
      "SIZE = 4",
      "  ELSE",
      "SIZE = 8",
      "  ENDC",
      "  ds.b SIZE",
    ].join("\n");
    // Not 8, which the last arm would give: it depends on which arm was taken.
    expect(usedBytes(source)).toBe(0);
  });

  it("keeps a value every arm agrees on", () => {
    const source = [
      "  IFNE DEBUG",
      "SIZE = 4",
      "  ELSE",
      "SIZE = 4",
      "  ENDC",
      "  ds.b SIZE",
    ].join("\n");
    expect(usedBytes(source)).toBe(4);
  });

  it("is unknown after a block with no ELSE that may not have run", () => {
    const source = ["  IFND SIZE", "SIZE = 4", "  ENDC", "  ds.b SIZE"].join(
      "\n",
    );
    expect(usedBytes(source)).toBe(0);
  });

  it("keeps a value already known when the block assigns the same again", () => {
    const source = [
      "SIZE = 4",
      "  IFND SIZE",
      "SIZE = 4",
      "  ENDC",
      "  ds.b SIZE",
    ].join("\n");
    expect(usedBytes(source)).toBe(4);
  });

  it("is unknown when a block changes a value that was known", () => {
    const source = [
      "SIZE = 4",
      "  IFNE DEBUG",
      "SIZE = 8",
      "  ENDC",
      "  ds.b SIZE",
    ].join("\n");
    expect(usedBytes(source)).toBe(0);
  });

  it("is known inside the arm that assigns it", () => {
    const source = ["  IFNE DEBUG", "N = 3", "  ds.b N", "  ENDC"].join("\n");
    const lines = parse(source);
    expect(lines[2].bytes).toBe(3);
  });

  it("follows each arm from what was known before the block", () => {
    const source = [
      "N = 2",
      "  IFNE DEBUG",
      "N = N+1",
      "  ELSE",
      "  ds.b N",
      "  ENDC",
    ].join("\n");
    // In the ELSE arm N is still 2, not the 3 the first arm made it.
    expect(parse(source)[4].bytes).toBe(2);
  });

  it("settles through nested blocks", () => {
    const agreed = [
      "  IFNE A",
      "  IFNE B",
      "X = 1",
      "  ELSE",
      "X = 1",
      "  ENDC",
      "  ELSE",
      "X = 1",
      "  ENDC",
      "  ds.b X",
    ].join("\n");
    expect(usedBytes(agreed)).toBe(1);
    const differ = agreed.replace(
      "X = 1\n  ENDC\n  ELSE",
      "X = 2\n  ENDC\n  ELSE",
    );
    expect(usedBytes(differ)).toBe(0);
  });

  it("treats ELSEIF as another arm and leaves the block open-ended", () => {
    const source = [
      "  IFNE A",
      "X = 1",
      "  ELSEIF B",
      "X = 1",
      "  ENDC",
      "  ds.b X",
    ].join("\n");
    // Neither arm need have run, so X may be unset.
    expect(usedBytes(source)).toBe(0);
  });

  it("leaves labels alone: their offsets count every arm", () => {
    const source = [
      "  IFNE DEBUG",
      "a:",
      "  dc.b 1,2",
      "b:",
      "  ENDC",
      "  ds.b b-a",
    ].join("\n");
    expect(usedBytes(source)).toBe(2);
  });

  it("is only about conditionals: an unconditional constant is as before", () => {
    expect(usedBytes(["SIZE = 4", "  ds.b SIZE"].join("\n"))).toBe(4);
  });
});

describe("iif", () => {
  it("counts the statement it makes conditional", () => {
    const [line] = parse("  iif DEBUG move.w d0,d1");
    // As vasm assembles it when the condition holds: a word.
    expect(line.bytes).toBe(2);
    expect(line.timing).toBeDefined();
  });

  it("counts an instruction with no operands, and data", () => {
    expect(parse("  iif 1 nop")[0].bytes).toBe(2);
    expect(parse("  iif 1 dc.b 1,2,3")[0].bytes).toBe(3);
  });

  it("keeps the line's own text for display", () => {
    const [line] = parse("  iif DEBUG nop");
    expect(line.statement.text).toBe("  iif DEBUG nop");
  });

  it("adds to the running total, once", () => {
    // The label after it is 2 bytes on, not 4.
    const source = ["  iif DEBUG nop", "end:", "  ds.b end"].join("\n");
    expect(parse(source)[2].bytes).toBe(2);
  });
});
