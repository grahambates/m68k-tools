import { type TextEdit } from "vscode-languageserver-types";
import { locationAsRange } from "../../geometry";
import { type FormatContext, type Formatter } from "../DocumentFormatter";

export type OperandSpaceOptions = "on" | "off" | "any";

class OperandSpaceFormatter implements Formatter {
  constructor(private options: OperandSpaceOptions) {}

  format({ parsed, text }: FormatContext): TextEdit[] {
    if (this.options === "any") {
      return []; // No changes
    }

    const edits: TextEdit[] = [];
    const expected = this.options === "on" ? ", " : ",";
    const lines = text.split(/\r\n?|\n/);

    for (const [index, parsedLine] of parsed.lines.entries()) {
      const operands = parsedLine.operands;
      if (!operands || operands.length < 2) {
        continue;
      }
      const lineText = lines[index] ?? "";

      // Iterate over operands in list, excluding last:
      for (let i = 0; i < operands.length - 1; i++) {
        const { end } = operands[i].loc;
        const { start } = operands[i + 1].loc;
        if (lineText.slice(end, start) === expected) {
          continue;
        }
        edits.push({
          range: locationAsRange({ start: end, end: start }, index),
          newText: expected,
        });
      }
    }

    return edits;
  }
}

export default OperandSpaceFormatter;
