import { CodeLens, type CodeLensProvider, type Command, Range } from "vscode";

export default class AnnotateCodeLensProvider implements CodeLensProvider {
  async provideCodeLenses(): Promise<CodeLens[]> {
    const topOfDocument = new Range(1, 0, 0, 0);

    const c: Command = {
      command: "68kcounter.toggleCounts",
      title: "Toggle counts",
    };

    const codeLens = new CodeLens(topOfDocument, c);

    return [codeLens];
  }
}
