import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { configFileName } from "../config";
import { defaultOptions } from "../options";
import type { FormatterOptions } from "../formatter/DocumentFormatter";

/**
 * The questions are asked through this rather than readline directly, so the
 * flow can be driven by a test without a terminal.
 */
export interface Prompt {
  choice<T extends string>(
    question: string,
    choices: readonly T[],
    fallback: T,
  ): Promise<T>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
}

export interface InitAnswers {
  case: "lower" | "upper" | "any";
  labelColon: "on" | "off" | "notInline" | "onlyInline" | "any";
  quotes: "double" | "single" | "any";
  operandSpace: "on" | "off" | "any";
  indentStyle: "space" | "tab";
  trimWhitespace: boolean;
  finalNewLine: boolean;
  endOfLine: "lf" | "cr" | "crlf";
}

const CASES = ["lower", "upper", "any"] as const;
const LABEL_COLONS = ["on", "off", "notInline", "onlyInline", "any"] as const;
const QUOTES = ["double", "single", "any"] as const;
const OPERAND_SPACES = ["on", "off", "any"] as const;
const INDENT_STYLES = ["space", "tab"] as const;
const LINE_ENDINGS = ["lf", "cr", "crlf"] as const;

/**
 * Narrowed, non-optional copies of the library defaults this module cares
 * about. `defaultOptions`'s fields are all optional on `FormatterOptions`,
 * but the shipped defaults always set them.
 */
const defaults: InitAnswers = {
  case: defaultOptions.case as InitAnswers["case"],
  labelColon: defaultOptions.labelColon as InitAnswers["labelColon"],
  quotes: defaultOptions.quotes as InitAnswers["quotes"],
  operandSpace: defaultOptions.operandSpace as InitAnswers["operandSpace"],
  indentStyle: (defaultOptions.align?.indentStyle ??
    "space") as InitAnswers["indentStyle"],
  trimWhitespace: defaultOptions.trimWhitespace ?? false,
  finalNewLine: defaultOptions.finalNewLine ?? true,
  endOfLine: (defaultOptions.endOfLine ?? "lf") as InitAnswers["endOfLine"],
};

export async function collectInitAnswers(prompt: Prompt): Promise<InitAnswers> {
  const caseOption = await prompt.choice(
    "Mnemonic/directive case",
    CASES,
    defaults.case,
  );
  const labelColon = await prompt.choice(
    "Label colons",
    LABEL_COLONS,
    defaults.labelColon,
  );
  const quotes = await prompt.choice("Quote style", QUOTES, defaults.quotes);
  const operandSpace = await prompt.choice(
    "Space after operand comma",
    OPERAND_SPACES,
    defaults.operandSpace,
  );
  const indentStyle = await prompt.choice(
    "Indent style",
    INDENT_STYLES,
    defaults.indentStyle,
  );
  const trimWhitespace = await prompt.confirm(
    "Trim trailing whitespace?",
    defaults.trimWhitespace,
  );
  const finalNewLine = await prompt.confirm(
    "Ensure a final newline?",
    defaults.finalNewLine,
  );
  const endOfLine = await prompt.choice(
    "Line endings",
    LINE_ENDINGS,
    defaults.endOfLine,
  );

  return {
    case: caseOption,
    labelColon,
    quotes,
    operandSpace,
    indentStyle,
    trimWhitespace,
    finalNewLine,
    endOfLine,
  };
}

/**
 * Only non-default values are written. A config full of restated defaults is
 * noise, and it silently pins behaviour the user never chose.
 */
export function renderInitConfig(answers: InitAnswers): string {
  const config: FormatterOptions = {};
  if (answers.case !== defaults.case) config.case = answers.case;
  if (answers.labelColon !== defaults.labelColon)
    config.labelColon = answers.labelColon;
  if (answers.quotes !== defaults.quotes) config.quotes = answers.quotes;
  if (answers.operandSpace !== defaults.operandSpace)
    config.operandSpace = answers.operandSpace;
  if (answers.indentStyle !== defaults.indentStyle)
    config.align = { indentStyle: answers.indentStyle };
  if (answers.trimWhitespace !== defaults.trimWhitespace)
    config.trimWhitespace = answers.trimWhitespace;
  if (answers.finalNewLine !== defaults.finalNewLine)
    config.finalNewLine = answers.finalNewLine;
  if (answers.endOfLine !== defaults.endOfLine)
    config.endOfLine = answers.endOfLine;
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** A one-line summary of what the generated config actually turns on. */
export function describeInitConfig(answers: InitAnswers): string {
  return [
    `case ${answers.case}`,
    `labelColon ${answers.labelColon}`,
    `quotes ${answers.quotes}`,
    `operandSpace ${answers.operandSpace}`,
    `indentStyle ${answers.indentStyle}`,
    `endOfLine ${answers.endOfLine}`,
  ].join(", ");
}

/**
 * Wraps a readline interface as a Prompt. Takes the minimal shape it needs
 * rather than the interface type, so a test can drive it with a fake.
 */
export function terminalPrompt(rl: {
  question: (query: string) => Promise<string>;
}): Prompt {
  const askLine = async (question: string, shown: string) =>
    (await rl.question(`${question} ${shown}: `)).trim();
  return {
    async choice(question, choices, fallback) {
      for (;;) {
        const answer = await askLine(
          `${question} (${choices.join(", ")})`,
          `[${fallback}]`,
        );
        if (!answer) return fallback;
        if ((choices as readonly string[]).includes(answer))
          return answer as typeof fallback;
        console.error(`  Expected one of: ${choices.join(", ")}`);
      }
    },
    async confirm(question, fallback) {
      const answer = await askLine(question, fallback ? "[Y/n]" : "[y/N]");
      if (!answer) return fallback;
      return /^y(es)?$/i.test(answer);
    },
  };
}

/**
 * Ask the questions and write the config file.
 *
 * Lives here with the answers it collects rather than in the entry point, and
 * returns an exit code instead of exiting, so the caller decides what a
 * cancelled run means.
 */
export async function runInit(): Promise<number> {
  if (!process.stdin.isTTY) {
    console.error(
      "m68k-format: --init needs an interactive terminal. Write .m68k-format.json by hand instead.",
    );
    return 2;
  }

  const target = resolve(process.cwd(), configFileName);
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let existing = false;
    try {
      await readFile(target, "utf8");
      existing = true;
    } catch {
      // No config yet, which is the normal case.
    }

    const prompt = terminalPrompt(rl);
    if (
      existing &&
      !(await prompt.confirm(
        `${configFileName} already exists. Overwrite?`,
        false,
      ))
    ) {
      console.log("Cancelled; nothing written.");
      return 0;
    }

    const answers = await collectInitAnswers(prompt);
    const contents = renderInitConfig(answers);
    console.log(`\n${contents}`);
    if (!(await prompt.confirm(`Write ${configFileName}?`, true))) {
      console.log("Cancelled; nothing written.");
      return 0;
    }

    await writeFile(target, contents, "utf8");
    console.log(`Created ${configFileName} (${describeInitConfig(answers)})`);
    return 0;
  } finally {
    rl.close();
  }
}
