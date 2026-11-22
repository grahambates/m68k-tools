import { isLabelPosition } from "../src/labelEnter";

vi.mock("vscode", () => ({}), { virtual: true });

it.each([
  ["Loop", 4],
  [".again", 6],
  ["  Loop:move.w d0,d1", 6],
  ["  Loop::", 8],
  ["COUNT equ 7", 5],
])("recognises the definition field in %s at %d", (line, column) => {
  expect(isLabelPosition(line, column)).toBe(true);
});

it.each([
  ["", 0],
  ["Loop", 0],
  ["  mov", 5],
  ["  move.l d", 10],
  ["Loop:mov", 8],
  ["Loop: move.l d", 14],
  ["COUNT equ 7", 11],
  ["; Loop", 6],
])("keeps native suggestion handling in %s at %d", (line, column) => {
  expect(isLabelPosition(line, column)).toBe(false);
});
