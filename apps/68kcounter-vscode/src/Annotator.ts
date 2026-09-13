import {
  Disposable,
  Range,
  StatusBarAlignment,
  type StatusBarItem,
  type TextDocument,
  type TextDocumentChangeEvent,
  type TextEditor,
  type TextEditorDecorationType,
  type TextEditorSelectionChangeEvent,
  ThemeColor,
  window,
  workspace,
} from "vscode";
import parse, {
  formatTiming,
  type Level,
  Levels,
  timingLevel,
  calculateTotals,
  type Line,
  type Timing,
} from "68kcounter";
import debounce from "debounce";

const colorPre = new ThemeColor("textPreformat.foreground");
const colors: Record<Level, ThemeColor | string> = {
  [Levels.VHigh]: "#f44",
  [Levels.High]: new ThemeColor("editorError.foreground"),
  [Levels.Med]: new ThemeColor("editorWarning.foreground"),
  [Levels.Low]: new ThemeColor("editorInfo.foreground"),
};

interface Annotation {
  text: string;
  hoverMessage: string;
  color: ThemeColor | string;
}

/**
 * Manages timing annotations for an editor instance
 */
export class Annotator implements Disposable {
  private document: TextDocument;
  private lines: Line[] = [];
  private statusBarItem: StatusBarItem;
  private disposable: Disposable;
  private visible = false;
  private type: TextEditorDecorationType;

  constructor(document: TextDocument) {
    this.type = window.createTextEditorDecorationType({
      light: {
        before: {
          backgroundColor: "rgba(0, 0, 0, .02)",
        },
      },
      dark: {
        before: {
          backgroundColor: "rgba(255, 255, 255,.02)",
        },
      },
      before: {
        width: "210px",
        borderColor: new ThemeColor("editorInfo.foreground"),
        textDecoration: `;border-width: 0 2px 0 0; border-style: solid; margin-right: 26px; padding: 0 6px; text-align: right;`,
      },
    });

    this.document = document;
    const subscriptions: Disposable[] = [];
    workspace.onDidChangeTextDocument(
      debounce(this.onChange, 100, true),
      this,
      subscriptions,
    );
    window.onDidChangeTextEditorSelection(
      this.onSelection,
      this,
      subscriptions,
    );
    window.onDidChangeActiveTextEditor(
      this.onChangeEditor,
      this,
      subscriptions,
    );

    this.disposable = Disposable.from(...subscriptions);
    this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    this.show();
  }

  dispose(): void {
    this.hide();
    this.statusBarItem.dispose();
    this.disposable.dispose();
    this.type.dispose();
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    this.visible = true;

    this.lines = parse(this.document.getText());
    const annotations = this.lines.map(this.buildAnnotation);

    window.activeTextEditor?.setDecorations(
      this.type,
      annotations.map(({ text, color, hoverMessage }, i) => ({
        range: new Range(i, 0, i, 0),
        hoverMessage,
        renderOptions: { before: { contentText: text || " ", color } },
      })),
    );
    this.showTotals();
  }

  hide(): void {
    this.visible = false;
    window.activeTextEditor?.setDecorations(this.type, []);
    this.statusBarItem.hide();
  }

  private showTotals() {
    const selection = window.activeTextEditor?.selection;
    const lines =
      selection && selection.start.line !== selection.end.line
        ? this.lines.slice(selection.start.line, selection.end.line + 1)
        : this.lines;

    const totals = calculateTotals(lines);
    let text = "Bytes: " + totals.bytes;
    if (totals.bssBytes) {
      text += ` (${totals.bssBytes} bss)`;
    }
    text += " | Cycles: " + formatTiming(totals.min);
    if (totals.isRange) {
      text += "–" + formatTiming(totals.max);
    }
    this.statusBarItem.text = text;
    this.statusBarItem.show();
  }

  /**
   * Get annotation text and color for a line of code
   */
  private buildAnnotation(line: Line): Annotation {
    const { bytes, timing } = line;
    let text = "";
    let color: ThemeColor | string = colorPre;
    if (timing) {
      text += timing.values.map(formatTiming).join(" ");
      const level = timingLevel(timing.values[0]);
      color = colors[level];
    }
    if (bytes) {
      text += " " + bytes;
    }

    const infoLines: string[] = [];
    if (line.timing && line.timing.values.length > 1) {
      infoLines.push(line.timing.labels.join(" / "));
    }
    const calculation = line.timing?.calculation;
    if (calculation) {
      if (
        calculation.multiplier ||
        (calculation?.ea && calculation.ea[0] > 0)
      ) {
        let calc = formatCalculation(
          calculation.base[0],
          calculation.multiplier,
        );
        if (calculation?.ea && calculation.ea[0] > 0) {
          calc += ` + EA: ${formatTiming(calculation.ea)}`;
        }
        infoLines.push(calc);
      }
      if (calculation?.n) {
        infoLines.push(`n = ${calculation.n}`);
      }
    }

    const hoverMessage =
      infoLines.length > 1
        ? infoLines.map((s) => " * " + s).join("\n")
        : infoLines.join("\n");

    return { text, color, hoverMessage };
  }

  private onSelection(e: TextEditorSelectionChangeEvent) {
    if (this.visible && e.textEditor.document === this.document) {
      this.showTotals();
    }
  }

  private onChangeEditor(e?: TextEditor) {
    if (this.visible && e?.document === this.document) {
      this.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  private onChange(e: TextDocumentChangeEvent) {
    if (this.visible && e.document === this.document) {
      this.show();
    }
  }
}

const formatCalculation = (timing: Timing, multiplier?: Timing) => {
  const strVals = timing.map((v) => String(v));

  if (multiplier) {
    for (const i in multiplier) {
      if (multiplier[i]) {
        strVals[i] += "+" + multiplier[i] + "n";
      }
    }
  }

  return `${strVals[0]}(${strVals[1]}/${strVals[2]})`;
};
