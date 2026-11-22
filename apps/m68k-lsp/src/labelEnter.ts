import { commands, window } from "vscode";

// A bare name starts at column one. An indented name needs a colon to be a
// label, so an instruction or macro invocation in the mnemonic column keeps
// the editor's normal Enter behavior.
const labelAtStart = /^[ \t]*([A-Za-z0-9_.$\\<>@!?+-]+)(?:(:+)|(?=$|[ \t;*=]))/;

export function isLabelPosition(line: string, column: number): boolean {
  const match = labelAtStart.exec(line);
  if (!match) return false;
  const start = match[0].length - match[1].length - (match[2]?.length ?? 0);
  if (start > 0 && !match[2]) return false;
  const end = match[0].length;
  return column > start && column <= end;
}

export function registerLabelEnter() {
  return commands.registerCommand("m68k.enterWithSuggestion", async () => {
    const editor = window.activeTextEditor;
    if (!editor) return;
    const onLabel = editor.selections.every(
      ({ isEmpty, active }) =>
        isEmpty &&
        isLabelPosition(
          editor.document.lineAt(active.line).text,
          active.character,
        ),
    );
    if (!onLabel) {
      await commands.executeCommand("acceptSelectedSuggestion");
      return;
    }
    await commands.executeCommand("hideSuggestWidget");
    if (window.activeTextEditor === editor) {
      await commands.executeCommand("type", { text: "\n" });
    }
  });
}
