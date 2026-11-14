import type { FormatterOptions } from "./formatter/DocumentFormatter";
export const defaultOptions: FormatterOptions = {
  case: "lower",
  labelColon: "on",
  equateColon: "off",
  macroColon: "off",
  quotes: "double",
  operandSpace: "off",
  align: {
    indentConditional: 0,
    indentRept: 0,
    indentMacro: 0,
    mnemonic: 8,
    operands: 16,
    comment: 48,
    operator: 0,
    value: 0,
    indentStyle: "space",
    tabSize: 8,
    autoExtend: "line",
  },
  trimWhitespace: false,
  finalNewLine: true,
  endOfLine: "lf",
};

export function mergeOptions(...options: FormatterOptions[]): FormatterOptions {
  return options.reduce<FormatterOptions>(
    (result, next) => ({
      ...result,
      ...next,
      align: { ...result.align, ...next.align },
    }),
    {},
  );
}
