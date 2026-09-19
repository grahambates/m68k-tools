import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { configFileNames } from "@m68k-lsp/assembly-options";
import type { FormatterOptions } from "./formatter/DocumentFormatter";
import { mergeOptions } from "./options";

export const configFileName = ".m68k-format.json";

async function readIfFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "EISDIR") throw error;
    return undefined;
  }
}

/** Whether a file is the shared project config rather than a formatter config. */
const isSharedConfig = (path: string) => basename(path).startsWith(".m68krc");

/**
 * Find the project configuration that applies from a directory, lowest
 * precedence first: the nearest `.m68k-format.json`, and the nearest shared
 * `.m68krc.json` that has a `format` section, which is what the language server
 * reads from it. Whichever is nearer goes on top, and where both are in one
 * directory the formatter's own file is the more specific and does. A shared
 * config with nothing for the formatter is passed over. Merge them with
 * `loadConfigs`.
 */
export async function findConfigs(directory: string): Promise<string[]> {
  let own: { path: string; depth: number } | undefined;
  let shared: { path: string; depth: number } | undefined;
  let current = resolve(directory);
  for (let depth = 0; !own || !shared; depth++) {
    const ownPath = join(current, configFileName);
    if (!own && (await readIfFile(ownPath)) !== undefined)
      own = { path: ownPath, depth };
    if (!shared) {
      for (const name of configFileNames) {
        const candidate = join(current, name);
        const text = await readIfFile(candidate);
        if (text === undefined) continue;
        try {
          if (isObject(JSON.parse(text)?.format)) {
            shared = { path: candidate, depth };
            break;
          }
        } catch {
          // Not JSON: the tool that owns the file will say so.
        }
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [shared, own]
    .filter((found): found is { path: string; depth: number } => !!found)
    .sort((a, b) => b.depth - a.depth)
    .map((found) => found.path);
}

/** The nearest project configuration, the one that takes precedence over any other found. */
export async function findConfig(
  directory: string,
): Promise<string | undefined> {
  return (await findConfigs(directory)).pop();
}

const isObject = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

/**
 * Read formatter options from a `.m68k-format.json`, which holds them directly,
 * or from the `format` section of a shared `.m68krc.json`.
 */
export async function loadConfig(path: string): Promise<FormatterOptions> {
  let value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (isSharedConfig(path))
    value = isObject(value)
      ? (value as { format?: unknown }).format
      : undefined;
  if (value === undefined) return {};
  if (!valid(value))
    throw new Error(`Invalid formatter configuration: ${path}`);
  const { $schema: _schema, ...options } = value as FormatterOptions & {
    $schema?: string;
  };
  return options;
}

/** Read several configurations and merge them, later ones over earlier. */
export async function loadConfigs(
  paths: readonly string[],
): Promise<FormatterOptions> {
  const loaded: FormatterOptions[] = [];
  for (const path of paths) loaded.push(await loadConfig(path));
  return mergeOptions(...loaded);
}
