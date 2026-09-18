import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { OptimizationGoal, Platform, Processor } from "../core/config.js";
import { defaultAssemblyExtensions } from "./file-discovery.js";
import { paint } from "./format.js";
import { VERSION } from "./version.js";

export const initConfigFileName = "m68k-lint.json";

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
  list(question: string, fallback: readonly string[]): Promise<string[]>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
}

export interface InitAnswers {
  platform: Platform;
  processors: Processor[];
  goal: OptimizationGoal;
  style: boolean;
  files: string[];
  ignores: string[];
}

const PLATFORMS: readonly Platform[] = ["generic", "amiga", "atari"];
const PROCESSORS: readonly Processor[] = [
  "mc68000",
  "mc68010",
  "mc68020",
  "mc68030",
  "mc68040",
  "mc68060",
  "cpu32",
];
const GOALS: readonly OptimizationGoal[] = ["balanced", "speed", "size"];

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "obj",
  "target",
]);

async function containsAssembly(
  directory: string,
  extensions: readonly string[],
  depth: number,
): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (
      entry.isFile() &&
      extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))
    )
      return true;
    if (
      entry.isDirectory() &&
      depth > 0 &&
      !entry.name.startsWith(".") &&
      !SKIP_DIRECTORIES.has(entry.name)
    ) {
      if (
        await containsAssembly(
          join(directory, entry.name),
          extensions,
          depth - 1,
        )
      )
        return true;
    }
  }
  return false;
}

/**
 * Suggest source globs from where the assembly files actually are, rather than
 * from directory names. Sources in the project root are common enough that
 * guessing `src/**` would be wrong as often as it is right.
 */
export async function detectSourceGlobs(
  root: string,
  extensions: readonly string[] = defaultAssemblyExtensions,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return ["**"];
  }

  const directories: string[] = [];
  for (const entry of entries) {
    // Anything in the root means a narrower glob would miss files, so stop.
    if (
      entry.isFile() &&
      extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))
    )
      return ["**"];
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !SKIP_DIRECTORIES.has(entry.name)
    ) {
      directories.push(entry.name);
    }
  }

  const withSources: string[] = [];
  for (const name of directories) {
    if (await containsAssembly(join(root, name), extensions, 6))
      withSources.push(`${name}/**`);
  }
  return withSources.length ? withSources : ["**"];
}

export async function collectInitAnswers(
  prompt: Prompt,
  detectedFiles: readonly string[],
): Promise<InitAnswers> {
  const platform = await prompt.choice("Target platform", PLATFORMS, "generic");
  const processors = (await prompt.list(
    `Target processor(s), comma separated (${PROCESSORS.join(", ")})`,
    ["mc68000"],
  )) as Processor[];
  const goal = await prompt.choice("Optimization goal", GOALS, "balanced");
  const style = await prompt.confirm("Enable the opt-in style preset?", false);
  const files = await prompt.list("Source globs to lint", detectedFiles);
  const ignores = await prompt.list("Globs to ignore (blank for none)", []);

  return { platform, processors, goal, style, files, ignores };
}

export function validateProcessors(values: readonly string[]): Processor[] {
  const unknown = values.filter(
    (value) => !PROCESSORS.includes(value as Processor),
  );
  if (unknown.length)
    throw new Error(
      `Unknown processor(s): ${unknown.join(", ")}. Expected: ${PROCESSORS.join(", ")}`,
    );
  if (!values.length) throw new Error("At least one processor is required");
  return [...values] as Processor[];
}

/**
 * The schema as published with this version of the CLI.
 *
 * A URL rather than a path into `node_modules`: an assembly project rarely has
 * m68k-lint installed locally, so a relative path resolves to nothing and the
 * editor silently validates nothing. Pinned to the version that wrote the
 * file, so the schema matches the options this CLI actually understands.
 */
export const schemaUrl = (version: string = VERSION): string =>
  `https://cdn.jsdelivr.net/npm/m68k-lint@${version}/m68k-lint.schema.json`;

/**
 * Only non-default values are written. A config full of restated defaults is
 * noise, and it silently pins behaviour the user never chose.
 */
export function renderInitConfig(answers: InitAnswers): string {
  const config: Record<string, unknown> = {
    $schema: schemaUrl(),
  };
  if (answers.platform !== "generic") config.platform = answers.platform;
  if (answers.processors.length !== 1 || answers.processors[0] !== "mc68000")
    config.processors = answers.processors;
  if (answers.goal !== "balanced") config.goal = answers.goal;
  if (answers.style) config.presets = ["recommended", "style"];
  if (answers.files.length) config.files = answers.files;
  if (answers.ignores.length) config.ignores = answers.ignores;
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** A one-line summary of what the generated config actually turns on. */
export function describeInitConfig(answers: InitAnswers): string {
  const parts = [
    `platform ${answers.platform}`,
    `cpu ${answers.processors.join(",")}`,
    `goal ${answers.goal}`,
    answers.style ? "style preset on" : "style preset off",
  ];
  return parts.join(", ");
}

/** Ignore globs need a trailing /** to match files inside a directory. */
export function normalizeIgnoreGlobs(values: readonly string[]): string[] {
  return values.map((value) =>
    /[*?[\]]/.test(value) ? value : `${value.replace(/\/+$/, "")}/**`,
  );
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
    async list(question, fallback) {
      const answer = await askLine(
        question,
        `[${fallback.join(", ") || "none"}]`,
      );
      if (!answer) return [...fallback];
      return answer
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
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
export async function runInit(color: boolean): Promise<number> {
  if (!process.stdin.isTTY) {
    console.error(
      "m68k-lint: --init needs an interactive terminal. Write m68k-lint.json by hand instead;",
    );
    console.error(`its schema is at ${schemaUrl()}.`);
    return 2;
  }

  const target = resolve(process.cwd(), initConfigFileName);
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
        `${initConfigFileName} already exists. Overwrite?`,
        false,
      ))
    ) {
      console.log("Cancelled; nothing written.");
      return 0;
    }

    const answers = await collectInitAnswers(
      prompt,
      await detectSourceGlobs(process.cwd()),
    );
    answers.processors = validateProcessors(answers.processors);
    answers.ignores = normalizeIgnoreGlobs(answers.ignores);

    const contents = renderInitConfig(answers);
    console.log(`\n${contents}`);
    if (!(await prompt.confirm(`Write ${initConfigFileName}?`, true))) {
      console.log("Cancelled; nothing written.");
      return 0;
    }

    await writeFile(target, contents, "utf8");
    console.log(
      `${paint(color, 32, "Created")} ${initConfigFileName} (${describeInitConfig(answers)})`,
    );
    return 0;
  } catch (error) {
    console.error(
      `m68k-lint: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  } finally {
    rl.close();
  }
}
