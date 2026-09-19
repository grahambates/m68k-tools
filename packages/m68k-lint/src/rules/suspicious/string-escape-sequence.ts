import type { Rule } from "../../core/rule.js";
import { isInMacroDefinition, scanBlocks } from "../../analysis/blocks.js";

/** What an escape sequence would have meant, by the character after the backslash. */
const MEANING: Readonly<Record<string, number>> = {
  n: 10,
  r: 13,
  t: 9,
  "0": 0,
  a: 7,
  b: 8,
  e: 27,
  f: 12,
  v: 11,
};
const OTHER = new Set(["\\", '"', "'"]);

const DATA_DIRECTIVES = new Set(["dc", "db", "dw", "dl"]);

/**
 * A backslash escape in string data, such as `dc.b "Hello\n",0`.
 *
 * vasm does not process escape sequences in strings unless it is given `-esc`
 * (which the config's `escapeSequences` says): every character is one element
 * as written, so `"Hello\n"` is six elements, the backslash and the `n` among
 * them, not a newline. It assembles without complaint
 * and the wrong bytes end up in the data. The value is written as a separate
 * element instead, `dc.b "Hello",10,0`.
 *
 * Macro bodies are left alone: a backslash there starts a parameter (`\1`,
 * `\@`) and is replaced before the line is assembled.
 */
export const stringEscapeSequence: Rule = {
  meta: {
    id: "suspicious/string-escape-sequence",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag backslash escape sequences in string data, which vasm treats as plain characters",
    tags: ["strings", "data", "likely-typo"],
    docs: {
      note: "vasm only interprets escape sequences in strings when given -esc; otherwise `\\n` is two characters, a backslash and an n. Set `escapeSequences: true` for a project assembled with -esc, which turns this off. A backslash inside a macro definition starts a parameter and is not reported.",
    },
  },

  checkFile(ctx) {
    // With -esc they mean what they say.
    if (ctx.config.escapeSequences) return;
    const blocks = scanBlocks(ctx.file);
    ctx.file.lines.forEach((line, index) => {
      if (
        line.mnemonic?.type !== "directive" ||
        !DATA_DIRECTIVES.has(line.mnemonic.directive.toLowerCase()) ||
        isInMacroDefinition(blocks, index)
      )
        return;

      for (const operand of line.operands ?? []) {
        if (operand.type !== "string-literal") continue;
        const found = [...operand.content.matchAll(/\\(.)/g)]
          .map((match) => match[1])
          .filter((char) => char in MEANING || OTHER.has(char));
        if (!found.length) continue;

        const sequences = [...new Set(found)].map((char) => `\\${char}`);
        const listed = sequences.join(", ");
        const values = [...new Set(found)]
          .filter((char) => char in MEANING)
          .map((char) => `\\${char} is ${MEANING[char]}`);
        ctx.report({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence: "medium",
          message: `${listed} in a string is ${sequences.length > 1 ? "each two characters" : "two characters"}, not an escape sequence`,
          loc: operand.loc,
          suggestion: {
            description: values.length
              ? `Write the value as its own element, such as dc.b "text",10 (${values.join(", ")})`
              : "Write the character without the backslash",
            applicability: "manual",
          },
          notes: [
            {
              message:
                "vasm does not interpret escape sequences in strings unless it is given -esc, so each backslash is assembled as a character. If the project is assembled with -esc, set escapeSequences: true in the config.",
            },
          ],
        });
      }
    });
  },
};
