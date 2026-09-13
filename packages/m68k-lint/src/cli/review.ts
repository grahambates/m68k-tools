import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseFile } from "m68k-parser";
import { lintParsedFile } from "../core/lint.js";
import { runInteractive, type InteractiveResult } from "../core/interactive.js";
import type { Diagnostic } from "../core/diagnostic.js";
import type { LintConfig } from "../core/config.js";
import { formatDiagnostic } from "./format.js";
import { initConfigFileName } from "./init.js";

/**
 * Turn rules off for the whole project, in the config file.
 *
 * A rule that does not suit a project should be said once rather than
 * commented on every occurrence. Written by reading and re-emitting the JSON so
 * that anything already there, including keys this version does not know about,
 * survives.
 */
export async function disableRulesInConfig(
  configPath: string,
  ruleIds: readonly string[],
): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    // No config yet, or one we cannot read; start from an empty object rather
    // than refusing, since the rules still have to go somewhere.
  }
  const rules = {
    ...((existing.rules as Record<string, string> | undefined) ?? {}),
  };
  for (const ruleId of ruleIds) rules[ruleId] = "off";
  await writeFile(
    configPath,
    `${JSON.stringify({ ...existing, rules }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Review the findings in one file, one at a time.
 *
 * Each is shown as it would be reported, followed by what applying it would
 * do, so the choice is made with the same information the report carries. A
 * finding with no rewrite can still be allowed here or turned off for the
 * project: those are the useful answers to "I have looked at this".
 */
export async function reviewFile(
  path: string,
  source: string,
  diagnostics: readonly Diagnostic[],
  ask: (query: string) => Promise<string>,
  color: boolean,
): Promise<InteractiveResult> {
  return runInteractive(source, diagnostics, async (diagnostic) => {
    console.log(`\n${formatDiagnostic(path, source, diagnostic, color)}`);
    const fixable = diagnostic.suggestion?.replacement !== undefined;
    const choices = fixable ? "y/Y/n/N/a/d/q/?" : "n/N/a/d/q/?";
    for (;;) {
      // Case matters here, so the answer is not folded to lower case.
      const answer = (
        await ask(
          `  ${fixable ? "apply" : "no rewrite available"} [${choices}] `,
        )
      ).trim();
      if (answer === "?" || answer === "h") {
        if (fixable) {
          console.log("  y  apply the rewrite");
          console.log(
            `  Y  apply every remaining ${diagnostic.ruleId} without asking`,
          );
        }
        console.log("  n  skip, and report it again next time");
        console.log(
          `  N  skip every remaining ${diagnostic.ruleId} in this run`,
        );
        console.log("  a  allow here, adding a directive beside this code");
        console.log(`  d  disable ${diagnostic.ruleId} for the whole project`);
        console.log("  q  stop; what has been decided still stands");
        continue;
      }
      if (answer === "Y" && fixable) return "apply-rule";
      if (answer === "N") return "skip-rule";
      const lowered = answer.toLowerCase();
      if (lowered === "q") return "quit";
      if (lowered === "a") return "allow";
      if (lowered === "d") return "disable";
      if (lowered === "n" || lowered === "") return "skip";
      if (lowered === "y" && fixable) return "apply";
      console.error(`  Expected one of: ${choices}`);
    }
  });
}

export interface InteractiveSession {
  color: boolean;
  projectConfigPath?: string;
  projectRoot: string;
}

/**
 * Walk the files, reviewing each one's findings, and record what was decided.
 *
 * A rule turned off during the walk stays off for the files that follow, so the
 * same unwanted finding is not asked about once per occurrence.
 */
export async function runInteractiveFixes(
  files: readonly string[],
  config: LintConfig,
  session: InteractiveSession,
): Promise<number> {
  if (!process.stdin.isTTY) {
    console.error(
      "m68k-lint: --fix-interactive needs a terminal. Use --fix, or --fix-dry-run to see what it would do.",
    );
    return 2;
  }

  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let applied = 0;
  let suppressed = 0;
  const disabled = new Set<string>();
  try {
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const active = { ...config, rules: { ...config.rules } };
      for (const ruleId of disabled) active.rules[ruleId] = "off";
      const diagnostics = lintParsedFile(parseFile(source), source, active);
      if (diagnostics.length === 0) continue;
      const result = await reviewFile(
        file,
        source,
        diagnostics,
        (query) => rl.question(query),
        session.color,
      );
      if (result.output !== source)
        await writeFile(file, result.output, "utf8");
      applied += result.applied.length;
      suppressed += result.suppressed.length;
      for (const ruleId of result.disabledRules) disabled.add(ruleId);
      if (result.quit) break;
    }
  } finally {
    rl.close();
  }

  if (disabled.size) {
    const target =
      session.projectConfigPath ??
      resolve(session.projectRoot, initConfigFileName);
    await disableRulesInConfig(target, [...disabled]);
    console.log(
      `\nturned off in ${relative(process.cwd(), target) || target}: ${[...disabled].join(", ")}`,
    );
  }
  console.log(`${applied} applied, ${suppressed} allowed in place.`);
  return 0;
}
