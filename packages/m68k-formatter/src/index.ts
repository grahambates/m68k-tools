import { parseFile } from "m68k-parser";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Range, TextEdit } from "vscode-languageserver-types";
import DocumentFormatter, {
  type FormatterOptions,
} from "./formatter/DocumentFormatter";
import { defaultOptions, mergeOptions } from "./options";

export { DocumentFormatter, defaultOptions, mergeOptions };
export type {
  FormatterOptions,
  FormatContext,
} from "./formatter/DocumentFormatter";
export type { AlignOptions } from "./formatter/formatters/AlignFormatter";
export type { Range, TextEdit } from "vscode-languageserver-types";
export { loadConfig, loadConfigs, findConfig, findConfigs } from "./config";

/** Return edits against the original source, optionally limited to a range. */
export function formatEdits(
  source: string,
  options: FormatterOptions = {},
  range?: Range,
): TextEdit[] {
  const formatter = new DocumentFormatter(
    mergeOptions(defaultOptions, options),
  );
  const context = { text: source, parsed: parseFile(source) };
  return range
    ? formatter.formatRange(context, range)
    : formatter.format(context);
}

export function format(source: string, options: FormatterOptions = {}): string {
  return TextDocument.applyEdits(
    TextDocument.create("file:///source.s", "m68k", 1, source),
    formatEdits(source, options),
  );
}
