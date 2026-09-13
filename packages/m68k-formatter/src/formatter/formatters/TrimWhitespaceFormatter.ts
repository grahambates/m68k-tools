import { type TextEdit } from "vscode-languageserver-types";
import { type FormatContext, type Formatter } from "../DocumentFormatter";

class TrimWhitespaceFormatter implements Formatter {
  format({ text }: FormatContext): TextEdit[] {
    const edits: TextEdit[] = [];

    const lines = text.split(/\r\n?|\n/);

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/\s+$/);
      if (match && match.index !== undefined) {
        const start = match.index;
        const end = match.index + match[0].length;

        edits.push({
          range: {
            start: { line: i, character: start },
            end: { line: i, character: end },
          },
          newText: "",
        });
      }
    }

    return edits;
  }
}

export default TrimWhitespaceFormatter;
