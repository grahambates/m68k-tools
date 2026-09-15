import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App";

const CODE = "  move.l d0,d1\n  move.l d2,d3\n  move.l d4,d5";

test("parses code, selects a range, and clears selection", () => {
  render(<App />);

  const textarea = screen.getByPlaceholderText("Paste or drop ASM source here");
  fireEvent.change(textarea, { target: { value: CODE } });
  fireEvent.click(screen.getByText("Analyse"));

  const rows = document.querySelectorAll(".Line");
  expect(rows.length).toBe(3);

  // Start selection on row 0, finish on row 2
  fireEvent.click(rows[0]);
  fireEvent.click(rows[2]);

  // A LineTotals summary should now be rendered for the selected range
  expect(document.querySelector(".LineTotals")).not.toBeNull();

  // Clicking the clear (x) button should reset the selection
  fireEvent.click(screen.getByText("×"));
  expect(document.querySelector(".LineTotals")).toBeNull();

  // Re-select, then cancel by clicking the start row again
  fireEvent.click(rows[0]);
  fireEvent.click(rows[0]);
  expect(document.querySelectorAll(".Line.selected").length).toBe(0);

  // Escape key should also clear an in-progress selection
  fireEvent.click(rows[1]);
  fireEvent.mouseEnter(rows[1]);
  expect(document.querySelectorAll(".Line.selected").length).toBeGreaterThan(0);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.querySelectorAll(".Line.selected").length).toBe(0);
});

test("switches between 68000 and 68020 timings", () => {
  render(<App />);

  const textarea = screen.getByPlaceholderText("Paste or drop ASM source here");
  fireEvent.change(textarea, { target: { value: "  move.l d0,d1" } });
  fireEvent.click(screen.getByText("Analyse"));

  const row = within(document.querySelector(".Line") as HTMLElement);

  // 68000 timings show two bus-cycle values (reads/writes)
  expect(row.getByText("4(1/0)")).toBeInTheDocument();
  expect(screen.getByText("cycles(reads/writes) bytes")).toBeInTheDocument();
  // No cache model selector for the 68000, which has no cache
  expect(screen.queryByText("Cache")).toBeNull();

  // Switching to the 68020 re-parses with three bus-cycle values
  // (reads/prefetches/writes) and defaults to the worst case
  fireEvent.change(screen.getByLabelText("CPU"), {
    target: { value: "68020" },
  });
  expect(row.getByText("3(0/1/0)")).toBeInTheDocument();
  expect(
    screen.getByText("cycles(reads/prefetches/writes) bytes"),
  ).toBeInTheDocument();

  // Switching cache model to the cache-hit case changes the timing
  fireEvent.change(screen.getByLabelText("Cache"), {
    target: { value: "cache" },
  });
  expect(row.getByText("2(0/0/0)")).toBeInTheDocument();
});

test("source-selected 060 costs are labelled as cached operand references", () => {
  render(<App />);
  fireEvent.change(
    screen.getByPlaceholderText("Paste or drop ASM source here"),
    {
      target: { value: " machine mc68060\n move.l (a0),d0\n movep.l d0,4(a0)" },
    },
  );
  fireEvent.click(screen.getByText("Analyse"));
  expect(
    screen.getByText(/Reference sums, not elapsed sequence timings/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Incomplete timings: unsupported forms/),
  ).toBeInTheDocument();
  expect(screen.getByTitle(/no cached timing/)).toHaveTextContent("?");
});
