import {
  remappingHighlights,
  usageHighlightLines,
} from "../src/remappingHighlights";
import type { RegisterAccess, RegisterUsageResult } from "@m68k-lsp/protocol";

const usage: RegisterUsageResult = {
  documentVersion: 1,
  registers: ["d0", "d1"].map((name, line) => ({
    name,
    firstUse: { line, character: 1 },
    read: true,
    written: false,
    references: [
      {
        range: { start: { line, character: 1 }, end: { line, character: 3 } },
        spelling: name,
        kind: "explicit",
        access: "read",
      },
    ],
  })),
};

test("previews swaps without reporting a destination conflict", () => {
  const marks = remappingHighlights(usage, { d0: "d1", d1: "d0" }, []);
  expect(marks.map((m) => m.destination)).toEqual(["D1", "D0"]);
  expect(marks.every((m) => !m.warning)).toBe(true);
  expect(marks[0].hover).toBe("D0 → D1");
});
test("marks occupied and duplicate destinations as conflicts", () => {
  for (const mappings of [{ d0: "d1" }, { d0: "a0", d1: "a0" }]) {
    expect(
      remappingHighlights(usage, mappings, []).every(
        (m) => m.warning && m.hover.includes("Conflicting"),
      ),
    ).toBe(true);
  }
});
test("associates validation warnings only with affected lines", () => {
  const marks = remappingHighlights(usage, { d0: "a0", d1: "a1" }, [
    "Line 1: Invalid MOVEQ destination",
  ]);
  expect(marks.map((m) => m.warning)).toEqual([true, false]);
  expect(marks[0].hover).toContain("Invalid MOVEQ");
  expect(remappingHighlights(usage, {}, [])).toEqual([]);
});
test("highlights a usage line as a write when any reference on it may write", () => {
  const ref = (line: number, access: RegisterAccess) => ({
    range: { start: { line, character: 1 }, end: { line, character: 3 } },
    spelling: "d0",
    kind: "explicit" as const,
    access,
  });
  expect(
    usageHighlightLines([
      ref(0, "read"),
      ref(0, "read"),
      ref(1, "read"),
      ref(1, "write"),
      ref(2, "readwrite"),
      ref(3, "unknown"),
    ]),
  ).toEqual({ read: [0, 3], write: [1, 2] });
});
