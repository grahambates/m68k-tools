import { counterOptions } from "./settings";
import { window } from "vscode";
import process, {
  calculateTotals,
  formatTiming,
  formatTotalsTiming,
} from "68kcounter";

export default function countSelection(): void {
  const editor = window.activeTextEditor;
  if (!editor) {
    return;
  }
  const selection = editor.selection;
  const options = counterOptions(editor.document);
  const lines = process(editor.document.getText(), options);
  const endLine =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line
      : selection.end.line + 1;
  const selectedLines = lines.slice(selection.start.line, endLine);

  const totals = calculateTotals(selectedLines);
  let text = "Bytes: " + totals.bytes;
  if (totals.bssBytes) {
    text += ` (${totals.bssBytes} bss)`;
  }
  text += totals.timingGroups
    ? " " + formatTotalsTiming(totals)
    : " Cycles: " + formatTiming(totals.min);
  if (!totals.timingGroups && totals.isRange) {
    text += "–" + formatTiming(totals.max);
  }
  if (
    selectedLines.some((line) =>
      line.timing?.values.some((value) => value.length > 3),
    )
  )
    text += options.cacheModel === "cache" ? " (cached)" : " (uncached)";
  if (totals.timingGroups)
    text +=
      " (reference sums, not sequence timings; operand accesses, not external bus transfers)";
  if (selectedLines.some((line) => line.timingUnavailable))
    text += " — incomplete timings";
  window.showInformationMessage(text);
}
