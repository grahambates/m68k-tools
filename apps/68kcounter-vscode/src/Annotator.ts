import { counterOptions, onDidChangeCacheModel } from "./settings";
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
  formatTotalsTiming,
  timingReferenceDescription,
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
        width: "280px",
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

    workspace.onDidChangeConfiguration(
      (event) => {
        if (
          this.visible &&
          event.affectsConfiguration("68kcounter", this.document.uri)
        )
          this.show();
      },
      undefined,
      subscriptions,
    );
    subscriptions.push(
      onDidChangeCacheModel((document) => {
        if (this.visible && document === this.document) this.show();
      }),
    );
    this.disposable = Disposable.from(...subscriptions);
    this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    this.statusBarItem.command = "68kcounter.toggleCacheModel";
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

    this.lines = parse(this.document.getText(), counterOptions(this.document));
    const annotations = this.lines.map((line) => this.buildAnnotation(line));

    const editor = window.activeTextEditor;
    if (editor?.document !== this.document) return;
    editor.setDecorations(
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
    for (const editor of window.visibleTextEditors) {
      if (editor.document === this.document)
        editor.setDecorations(this.type, []);
    }
    this.statusBarItem.hide();
  }

  private showTotals() {
    const selection = window.activeTextEditor?.selection;
    const lines =
      selection && selection.start.line !== selection.end.line
        ? this.lines.slice(
            selection.start.line,
            selection.end.line + (selection.end.character === 0 ? 0 : 1),
          )
        : this.lines;

    const totals = calculateTotals(lines);
    let text = "Bytes: " + totals.bytes;
    if (totals.bssBytes) {
      text += ` (${totals.bssBytes} bss)`;
    }
    text += totals.timingGroups
      ? " | " + formatTotalsTiming(totals)
      : " | Cycles: " + formatTiming(totals.min);
    if (!totals.timingGroups && totals.isRange) {
      text += "–" + formatTiming(totals.max);
    }
    const options = counterOptions(this.document);
    if (
      lines.some((line) =>
        line.timing?.values.some((value) => value.length > 3),
      )
    )
      text += options.cacheModel === "cache" ? " | Cached" : " | Uncached";
    this.statusBarItem.tooltip =
      "Cycles: clocks(reads/prefetches/writes) for 68020/68030; clocks(reads/writes) for 68000. Click to toggle cached/uncached timings for this document.";
    const cachedOnly = totals.timingGroups?.every((group) =>
      group.model.includes("cached"),
    );
    this.statusBarItem.command = cachedOnly
      ? undefined
      : "68kcounter.toggleCacheModel";
    if (totals.timingGroups)
      this.statusBarItem.tooltip =
        "Cached reference sums, not elapsed sequence timings. Operand accesses are not external bus transfers. 68040/68060 currently have no uncached model.";
    if (lines.some((line) => line.timingUnavailable))
      text += " | Incomplete timings";
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
      text +=
        timing.groups && timing.groups.length > 1
          ? "Mixed timing models"
          : timing.values.map(formatTiming).join(" ");
      const level = timingLevel(timing.values[0]);
      color = colors[level];
    }
    if (line.timingUnavailable) text += "?";
    if (bytes) {
      text += " " + bytes;
    }

    const options = counterOptions(this.document);
    const extended = timing?.values.some((value) => value.length > 3);
    const infoLines: string[] = timing
      ? [
          timingReferenceDescription(timing) ??
            (extended
              ? `Clocks(reads/prefetches/writes), ${options.cacheModel === "cache" ? "cached" : "uncached"}`
              : "Clocks(reads/writes)"),
        ]
      : [];
    if (line.timingUnavailable) infoLines.push(line.timingUnavailable);
    if (timing?.reference?.note) infoLines.push(timing.reference.note);
    const stages = timing?.reference?.stages;
    if (stages)
      infoLines.push(
        `EA calculate: ${stages.calculate}; execute: ${stages.executeLead} lead + ${stages.executeBase} base. Stages overlap; do not add these stage costs.`,
      );
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
          (options.cacheModel === "cache"
            ? (calculation.baseCache ?? calculation.base)
            : calculation.base)[0],
          calculation.multiplier,
        );
        if (calculation?.ea && calculation.ea[0] > 0) {
          calc += ` + EA: ${formatTiming(calculation.ea)}`;
        }
        infoLines.push(calc);
      }
      if (calculation?.n !== undefined) {
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

  return `${strVals[0]}(${strVals.slice(1).join("/")})`;
};
