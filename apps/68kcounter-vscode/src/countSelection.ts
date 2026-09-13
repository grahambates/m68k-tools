import { Range, window } from "vscode";
import process, { calculateTotals, formatTiming } from "68kcounter";

export default function countSelection(): void {
  const editor = window.activeTextEditor;
  if (!editor) {
    return;
  }
  const selection = editor.selection;
  const source = editor.document.getText(
    new Range(selection.start.line, 0, selection.end.line + 1, 0),
  );
  const selectedLines = process(source);

  const totals = calculateTotals(selectedLines);
  let text = "Bytes: " + totals.bytes;
  if (totals.bssBytes) {
    text += ` (${totals.bssBytes} bss)`;
  }
  text += " Cycles: " + formatTiming(totals.min);
  if (totals.isRange) {
    text += "–" + formatTiming(totals.max);
  }
  window.showInformationMessage(text);
}
