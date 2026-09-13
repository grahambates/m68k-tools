import { type TextEdit } from "vscode-languageserver-types";
import { locationAsRange } from "../../geometry";
import { type FormatContext, type Formatter } from "../DocumentFormatter";

type UseColon = "on" | "off" | "notInline" | "onlyInline" | "any";

export type LabelColonOptions =
  | UseColon
  | {
      global?: UseColon;
      local?: UseColon;
    };

class LabelColonFormatter implements Formatter {
  constructor(private options: LabelColonOptions) {}

  format({ parsed, text }: FormatContext): TextEdit[] {
    const edits: TextEdit[] = [];
    const options = this.options;
    const lines = text.split(/\r\n?|\n/);

    for (const [index, parsedLine] of parsed.lines.entries()) {
      const { label } = parsedLine;
      if (!label) {
        continue;
      }

      // A double colon exports the label, and the colons are part of that
      // meaning rather than a style choice, so those are left alone.
      if (label.scope === "external") {
        continue;
      }

      // A label node carries its own scope, so there is no need to work it out
      // from the name here.
      const scope = label.scope;
      const option = typeof options === "string" ? options : options[scope];
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
}

export default LabelColonFormatter;
