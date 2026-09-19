import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FormatterOptions } from "./formatter/DocumentFormatter";

export const configFileName = ".m68k-format.json";

/** Find the nearest project configuration, starting at a directory. */
export async function findConfig(
  directory: string,
): Promise<string | undefined> {
  let current = resolve(directory);
  for (;;) {
    const candidate = join(current, configFileName);
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

type Validator = (value: unknown) => boolean;
const choice =
  (...values: unknown[]): Validator =>
  (value) =>
    values.includes(value);
const boolean: Validator = (value) => typeof value === "boolean";
const column: Validator = (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const object =
  (schema: Record<string, Validator>): Validator =>
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(([key, item]) => schema[key]?.(item));
const casing = choice("upper", "lower", "any");
const colon = choice("on", "off", "notInline", "onlyInline", "any");
const valid = object({
  $schema: (value) => typeof value === "string",
  case: (value) =>
    casing(value) ||
    object(
      Object.fromEntries(
        [
          "instruction",
          "directive",
          "control",
          "register",
          "sectionType",
          "hex",
        ].map((key) => [key, casing]),
      ),
    )(value),
  labelColon: (value) =>
    colon(value) || object({ global: colon, local: colon })(value),
  quotes: choice("double", "single", "any"),
  operandSpace: choice("on", "off", "any"),
  trimWhitespace: boolean,
  finalNewLine: boolean,
  endOfLine: choice("lf", "cr", "crlf"),
  align: object({
    mnemonic: column,
    operands: column,
    comment: column,
    operator: column,
    value: column,
    indentConditional: column,
    indentRept: column,
    indentMacro: column,
    tabSize: (value) => column(value) && (value as number) > 0,
    indentStyle: choice("space", "tab"),
    autoExtend: choice("line", "file", "block"),
    standaloneComment: (value) =>
      column(value) ||
      choice(
        "ignore",
        "nearest",
        "label",
        "mnemonic",
        "operands",
        "comment",
        "operator",
        "value",
      )(value),
  }),
});

/** Read a JSON object containing formatter options (without a `format` wrapper). */
export async function loadConfig(path: string): Promise<FormatterOptions> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!valid(value))
    throw new Error(`Invalid formatter configuration: ${path}`);
  const { $schema: _schema, ...options } = value as FormatterOptions & {
    $schema?: string;
  };
  return options;
}
