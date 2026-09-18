import type { Rule } from "../../core/rule.js";
import { analyzeAlignment } from "../../analysis/alignment.js";
import { isExecutableLine } from "../../util/ast.js";

/** Processors that fault on a word or long access at an odd address. */
const STRICT_ALIGNMENT = ["mc68000", "mc68010", "cpu32"];

/**
 * Word-sized code or data straight after an odd number of bytes.
 *
 * `dc.b "Hello",0` leaves the next address odd whenever the string is an even
 * number of characters, and nothing warns about it until something reads a
 * word from there. An instruction at an odd address is an address error on
 * every 68k; word and long data are only an error on the 68000 and 68010 (later
 * processors merely take longer), so data is reported only when one of those is
 * a target.
 *
 * Reported once per odd stretch, at the first line that needs alignment, since
 * the lines after it are odd for the same reason.
 */
export const missingEven: Rule = {
  meta: {
    id: "suspicious/missing-even",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag an instruction or word-sized data placed after an odd number of bytes",
    tags: ["alignment", "data"],
    docs: {
      note: "Follows the size of `dc.b`, `ds.b` and `dcb.b` data through the section, restarting at `even`, `cnop`, `align` and each new section. Silent whenever the position cannot be worked out, such as after an INCLUDE, INCBIN, macro or conditional block.",
    },
  },

  checkFile(ctx) {
    const alignment = analyzeAlignment(ctx.file, (expr) => {
      const result = ctx.evaluate(expr);
      return result.known ? result.value : undefined;
    });
    const strict = ctx.config.processors.some((cpu) =>
      STRICT_ALIGNMENT.includes(cpu),
    );

    let reportedFor: number | undefined;
    ctx.file.lines.forEach((line, index) => {
      if (alignment.parityBefore(index) !== 1) return;
      const cause = alignment.oddSource(index);
      if (cause === undefined || cause === reportedFor) return;

      const mnemonic = line.mnemonic;
      if (!mnemonic) return;
      const size =
        line.qualifier?.type === "size" ? line.qualifier.size : undefined;

      let what: string | undefined;
      if (isExecutableLine(line) && mnemonic.type === "instruction")
        what = "Instruction";
      else if (mnemonic.type === "directive" && strict) {
        const directive = mnemonic.directive.toLowerCase();
        if (directive === "dc" && size !== "b") what = "Word-sized data";
      }
      if (!what) return;

      reportedFor = cause;
      const causeLine = ctx.line(cause);
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "high",
        message: `${what} follows an odd number of bytes, so it starts at an odd address`,
        loc: mnemonic.loc,
        notes: [
          {
            message: `The data on line ${causeLine?.lineNumber ?? cause + 1} leaves the address odd. ${what === "Instruction" ? "Executing an instruction at an odd address is an address error" : "A word or long access here is an address error on the 68000 and 68010"}.`,
          },
        ],
        suggestion: {
          description: "Add EVEN before this line",
          applicability: "manual",
        },
      });
    });
  },
};
