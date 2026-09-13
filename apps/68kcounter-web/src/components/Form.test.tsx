import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { Form } from "./Form";

test("file drops use the latest submit callback and reset the drag overlay", async () => {
  const oldSubmit = vi.fn();
  const submit = vi.fn();
  const { rerender } = render(<Form onSubmit={oldSubmit} />);
  rerender(<Form onSubmit={submit} />);
  const overlay = screen.getByText("Drop here").parentElement!;
  const dropper = overlay.parentElement!;
  fireEvent.dragEnter(document);
  fireEvent.dragEnter(overlay);
  expect(dropper).toHaveClass("isDragging");
  fireEvent.drop(overlay, {
    dataTransfer: { files: [{ text: () => Promise.resolve("  nop") }] },
  });
  await waitFor(() => expect(submit).toHaveBeenCalledWith("  nop"));
  expect(oldSubmit).not.toHaveBeenCalled();
  expect(dropper).not.toHaveClass("isDragging");
  fireEvent.dragEnter(document);
  fireEvent.dragLeave(document);
  expect(dropper).not.toHaveClass("isDragging");
});
