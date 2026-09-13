import { type TextEdit } from "vscode-languageserver-types";
import { walkLine } from "../../ast";
import { locationAsRange } from "../../geometry";
import { type FormatContext, type Formatter } from "../DocumentFormatter";

export type QuotesOptions = "double" | "single" | "any";

class QuotesFormatter implements Formatter {
  constructor(private options: QuotesOptions) {}

  format({ parsed, text }: FormatContext): TextEdit[] {
    const edits: TextEdit[] = [];
    const options = this.options;
    if (options === "any") {
      return edits;
    }

    // TODO: handle escaping, preferred based on quotes in string
    const wanted = options === "single" ? "'" : '"';
    const lines = text.split(/\r\n?|\n/);

    for (const [index, parsedLine] of parsed.lines.entries()) {
      for (const node of walkLine(parsedLine)) {
        if (node.type !== "string-literal") {
          continue;
        }
        const quote = (node as { quote?: string }).quote;
        // Chevron-quoted strings are a different construct, left alone.
        if (quote !== "'" && quote !== '"') {
          continue;
        }
        if (quote === wanted) {
          continue;
        }
        const raw = lines[index]?.slice(node.loc.start, node.loc.end);
        if (raw === undefined) {
          continue;
        }
        edits.push({
          range: locationAsRange(node.loc, index),
          newText: wanted + raw.slice(1, raw.length - 1) + wanted,
        });
      }
    }

    return edits;
  }
}

export default QuotesFormatter;
