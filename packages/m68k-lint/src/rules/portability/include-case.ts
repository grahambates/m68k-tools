import type { Rule } from "../../core/rule.js";
import { replaceOperandInLine } from "../optimization/helpers.js";

/** Directives whose operand is a path to a file. */
const FILE_DIRECTIVES = new Set(["include", "incbin"]);

/**
 * An include whose case is not the file's.
 *
 * On a file system that ignores case, `include "Exec/Types.i"` finds
 * `exec/types.i` and the assembler is content, so the author never hears of it.
 * On a case-sensitive one, a colleague's Linux machine or a build server, the
 * same project fails to build. This says so where it can still be seen.
 *
 * Only what the file system resolves is reported; a path that finds nothing is
 * for the assembler to complain about. The linter reads no files itself, so the
 * caller works out what each path is called on disk and passes it in as
 * `FileFacts`; without that this stays silent.
 */
export const includeCase: Rule = {
  meta: {
    id: "portability/include-case",
    category: "portability",
    defaultSeverity: "warning",
    description:
      "Flag an INCLUDE or INCBIN path whose case differs from the file on disk",
    tags: ["portability", "include", "file-system"],
    docs: {
      note: "Assemblers on a case-insensitive file system (macOS, Windows) accept a path in the wrong case, so the author sees nothing, but the project does not build on a case-sensitive one (Linux). Reported when the path resolves here but is spelled differently on disk, with the path as it is on disk offered as the fix. Only checked when the linter is given the file's location, so not for text read from standard input.",
    },
  },

  checkFile(ctx) {
    const onDisk = ctx.facts?.includeCase;
    if (!onDisk?.size) return;

    ctx.file.lines.forEach((line, index) => {
      if (line.mnemonic?.type !== "directive") return;
      if (!FILE_DIRECTIVES.has(line.mnemonic.directive.toLowerCase())) return;
      const operand = line.operands?.[0];
      if (operand?.type !== "string-literal") return;

      const actual = onDisk.get(operand.content);
      if (!actual || actual === operand.content) return;

      const quote =
        operand.quote === "<>"
          ? ["<", ">"]
          : operand.quote
            ? [operand.quote, operand.quote]
            : ["", ""];
      const replacement = replaceOperandInLine(
        ctx,
        line,
        0,
        `${quote[0]}${actual}${quote[1]}`,
      );
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "certain",
        message: `'${operand.content}' is '${actual}' on disk, so it resolves here but not on a case-sensitive file system`,
        loc: operand.loc,
        notes: [
          {
            message:
              "macOS and Windows file systems ignore case, so this assembles for you. Linux, and most build servers, do not, and the same include fails there.",
          },
        ],
        suggestion: {
          description: `Use '${actual}'`,
          ...(replacement ? { replacement } : {}),
          applicability: replacement ? "safe" : "manual",
        },
        data: { written: operand.content, onDisk: actual, line: index + 1 },
      });
    });
  },
};
