import type { ParsedFile } from "m68k-parser";
import { type TextEdit, type Range } from "vscode-languageserver-types";
import { containsRange } from "../geometry";
import AlignFormatter, { type AlignOptions } from "./formatters/AlignFormatter";
import CaseFormatter, { type CaseOptions } from "./formatters/CaseFormatter";
import EndOfLineFormatter from "./formatters/EndOfLineFormatter";
import LabelColonFormatter, {
  type LabelColonOptions,
} from "./formatters/LabelColonFormatter";
import OperandSpaceFormatter, {
  type OperandSpaceOptions,
} from "./formatters/OperandSpaceFormatter";
import QuotesFormatter, {
  type QuotesOptions,
} from "./formatters/QuotesFormatter";
import TrimWhitespaceFormatter from "./formatters/TrimWhitespaceFormatter";

export interface FormatterOptions {
  align?: AlignOptions;
  case?: CaseOptions;
  endOfLine?: "lf" | "cr" | "crlf";
  finalNewLine?: boolean;
  labelColon?: LabelColonOptions;
  quotes?: QuotesOptions;
  trimWhitespace?: boolean;
  operandSpace?: OperandSpaceOptions;
  // TODO:
  // mnemonic aliases? equ vs =
  // multiple line breaks?
  // number format?
  // fix mnemononic at start of line?
  // require size qualifier?
  // C vs ASM style operators?
  // Comment style
  // label position if fits
}

/** The document being formatted, in both the forms formatters need. */
export interface FormatContext {
  parsed: ParsedFile;
  text: string;
}

export interface Formatter {
  format(ctx: FormatContext, prevEdits: TextEdit[]): TextEdit[];
}

class DocumentFormatter {
  private formatters: Formatter[] = [];

  constructor(options: Partial<FormatterOptions>) {
    if (options.case) {
      this.formatters.push(new CaseFormatter(options.case));
    }
    if (options.labelColon) {
      this.formatters.push(new LabelColonFormatter(options.labelColon));
    }
    if (options.quotes) {
      this.formatters.push(new QuotesFormatter(options.quotes));
    }
    if (options.operandSpace) {
      this.formatters.push(new OperandSpaceFormatter(options.operandSpace));
    }
    if (options.align) {
      this.formatters.push(new AlignFormatter(options.align));
    }
    if (options.trimWhitespace) {
      this.formatters.push(new TrimWhitespaceFormatter());
    }
    if (options.endOfLine) {
      this.formatters.push(
        new EndOfLineFormatter(options.endOfLine, options.finalNewLine),
      );
    }
  }

  format(ctx: FormatContext): TextEdit[] {
    const edits: TextEdit[] = [];

    for (const formatter of this.formatters) {
      edits.push(...formatter.format(ctx, edits));
    }

    return edits;
  }

  formatRange(ctx: FormatContext, range: Range) {
    const edits = this.format(ctx);
    return edits.filter((e) => containsRange(range, e.range));
  }
}

export default DocumentFormatter;
