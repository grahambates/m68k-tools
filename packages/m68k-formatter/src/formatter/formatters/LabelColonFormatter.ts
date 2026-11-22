import { type TextEdit } from "vscode-languageserver-types";
import { type LabelKind, labelKind, locationAsRange } from "m68k-parser";
import { type FormatContext, type Formatter } from "../DocumentFormatter";

type UseColon = "on" | "off" | "notInline" | "onlyInline" | "any";

export type LabelColonOptions =
  | UseColon
  | {
      global?: UseColon;
      local?: UseColon;
    };

/**
 * Colon style for a name that is not a label. Such a line always has a
 * directive after the name, so the inline variants would mean nothing.
 */
export type SymbolColonOptions = "on" | "off" | "any";

export interface ColonOptions {
  /** Labels marking a position, and `rs`/`so`/`fo` offsets. */
  label?: LabelColonOptions;
  /** Names given a value: `equ`, `=`, `set`, `equr`, `reg` and their kin. */
  equate?: SymbolColonOptions;
  /** Macro names: `Name macro`. */
  macro?: SymbolColonOptions;
}

class LabelColonFormatter implements Formatter {
  constructor(private options: ColonOptions) {}

  format({ parsed, text }: FormatContext): TextEdit[] {
    const edits: TextEdit[] = [];
    const lines = text.split(/\r\n?|\n/);

    for (const [index, parsedLine] of parsed.lines.entries()) {
      const { label } = parsedLine;
      const kind = labelKind(parsedLine);
      if (!label || !kind) {
        continue;
      }

      // A double colon exports the label, and the colons are part of that
      // meaning rather than a style choice, so those are left alone.
      if (label.scope === "external") {
        continue;
      }

      const option = this.optionFor(kind, label.scope);
      if (!option || option === "any") {
        continue;
      }

      // Inline means something other than a comment follows on the same line.
      const isInline = parsedLine.mnemonic !== undefined;
      const lineText = lines[index] ?? "";
      const hasColon = lineText[label.loc.end] === ":";

      if (
        (option === "on" ||
          (isInline && option === "onlyInline") ||
          (!isInline && option === "notInline")) &&
        !hasColon
      ) {
        const { end } = locationAsRange(label.loc, index);
        edits.push({ range: { start: end, end }, newText: ":" });
      }

      if (
        (option === "off" ||
          (isInline && option === "notInline") ||
          (!isInline && option === "onlyInline")) &&
        hasColon &&
        // Can't remove if label is not at position 0
        label.loc.start === 0
      ) {
        edits.push({
          range: locationAsRange(
            { start: label.loc.end, end: label.loc.end + 1 },
            index,
          ),
          newText: "",
        });
      }
    }

    return edits;
  }

  private optionFor(
    kind: LabelKind,
    scope: "global" | "local",
  ): UseColon | undefined {
    switch (kind) {
      case "equate":
        return this.options.equate;
      case "macro":
        return this.options.macro;
      default: {
        // An `rs` offset is written like a `ds` line, so it follows the same
        // style as the labels around it.
        const { label } = this.options;
        return typeof label === "string" ? label : label?.[scope];
      }
    }
  }
}

export default LabelColonFormatter;
