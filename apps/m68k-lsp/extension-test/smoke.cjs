const assert = require("node:assert/strict");
const vscode = require("vscode");

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

exports.run = async () => {
  const extension = vscode.extensions.getExtension("gigabates.m68k-lsp");
  assert.ok(extension, "Expected the assembly extension to be installed");
  await extension.activate();
  const workspace = vscode.workspace.workspaceFolders[0].uri;
  const main = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(workspace, "main.asm"),
  );
  const inactive = (line) =>
    vscode.languages
      .getDiagnostics(main.uri)
      .some(
        (diagnostic) =>
          diagnostic.code === "inactive-conditional" &&
          diagnostic.range.start.line === line &&
          diagnostic.tags?.includes(vscode.DiagnosticTag.Unnecessary),
      );
  const editor = await vscode.window.showTextDocument(main);
  try {
    await waitFor(() => inactive(7), "Expected the ELSE branch to be dimmed");
  } catch (error) {
    console.error(
      main.languageId,
      vscode.extensions.getExtension("gigabates.m68k-lsp")?.isActive,
      vscode.languages.getDiagnostics(main.uri),
    );
    throw error;
  }
  const hovers = await vscode.commands.executeCommand(
    "vscode.executeHoverProvider",
    main.uri,
    new vscode.Position(9, 12),
  );
  const hoverText = hovers
    .flatMap(({ contents }) =>
      contents.map((content) =>
        typeof content === "string" ? content : content.value,
      ),
    )
    .join("\n");
  assert.match(hoverText, /Expression = 2 \(\$2\)/);

  const header = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(workspace, "values.i"),
  );
  try {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(header.uri, header.lineAt(0).range, "FEATURE = 0");
    assert.ok(await vscode.workspace.applyEdit(edit));
    await waitFor(
      () => inactive(5) && !inactive(7),
      "Expected dimming to switch after editing the include",
    );

    const call = new vscode.Position(10, 1);
    editor.selection = new vscode.Selection(call, call);
    await vscode.commands.executeCommand("m68k.peekMacroExpansion");
    await waitFor(
      () =>
        vscode.window.visibleTextEditors.some(
          ({ document }) =>
            document.uri.scheme === "m68k-macro-expansion" &&
            document.getText().includes("moveq #3,d0"),
        ),
      "Expected the macro command to open the expanded assembly",
    );
  } finally {
    if (header.isDirty) await header.save();
  }
};
