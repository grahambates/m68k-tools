import { type Disposable, type TextDocument, window, workspace } from "vscode";
import { Annotator } from "./Annotator";

/**
 * Manages Annotator instances across the workspace
 */
export default class AnnotateController implements Disposable {
  private documentMap: Map<TextDocument, Annotator> = new Map();
  private subscription: Disposable;

  constructor() {
    this.subscription = workspace.onDidCloseTextDocument(
      this.onDidCloseTextDocument,
      this,
    );
  }

  toggle(): void {
    const document = window.activeTextEditor?.document;
    if (!document) {
      return;
    }
    const annotator = this.documentMap.get(document);
    if (annotator) {
      annotator.toggle();
    } else {
      this.documentMap.set(document, new Annotator(document));
    }
  }

  dispose(): void {
    this.documentMap.forEach((a) => a.dispose());
    this.subscription.dispose();
  }

  private onDidCloseTextDocument(doc: TextDocument) {
    const annotator = this.documentMap.get(doc);
    if (annotator) {
      this.documentMap.delete(doc);
      annotator.dispose();
    }
  }
}
