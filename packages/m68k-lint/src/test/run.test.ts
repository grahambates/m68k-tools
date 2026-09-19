import { vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, type CliOptions } from "../cli/args.js";
import { buildConfig, failsThreshold, inputRoot, run } from "../cli/run.js";
import type { Diagnostic, Severity } from "../core/diagnostic.js";

function options(argv: string[] = []): CliOptions {
  const parsed = parseArgs(argv, false);
  if (parsed === "help" || parsed === "version")
    throw new Error("expected options");
  return parsed;
}

const at = (severity: Severity) => ({ severity }) as Diagnostic;

/** Runs the CLI with output captured, so the exit code can be asserted quietly. */
async function capture(
  argv: string[],
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  const error = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
  try {
    return { code: await run(argv), out: out.join("\n"), err: err.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

/** A file with one finding a default run reports: MOVE.L #1 fits MOVEQ. */
async function fixture(
  contents = "start:\n\tmove.l\t#1,d0\n\trts\n",
): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "m68k-lint-run-"));
  const file = join(dir, "game.s");
  await writeFile(file, contents, "utf8");
  return { dir, file };
}

describe("buildConfig", () => {
  test("falls back to the defaults when nothing is specified", () => {
    const config = buildConfig(options());
    expect(config.processors).toEqual(["mc68000"]);
    expect(config.platform).toBe("generic");
    expect(config.goal).toBe("balanced");
    // An empty override map is dropped rather than passed through empty.
    expect(config.rules).toBeUndefined();
    expect(config.categories).toBeUndefined();
  });

  test("prefers the command line over the config file", () => {
    const config = buildConfig(
      options(["--platform", "amiga", "--goal", "size"]),
      {
        platform: "atari",
        goal: "speed",
        processors: ["mc68020"],
      },
    );
    expect(config.platform).toBe("amiga");
    expect(config.goal).toBe("size");
    // Not overridden on the command line, so the config file still decides.
    expect(config.processors).toEqual(["mc68020"]);
  });

  test("merges rule overrides, with the command line winning per rule", () => {
    const config = buildConfig(options(["--rule", "suspicious/nop=error"]), {
      rules: { "suspicious/nop": "off", "suspicious/self-move": "warning" },
    });
    expect(config.rules).toEqual({
      "suspicious/nop": "error",
      "suspicious/self-move": "warning",
    });
  });

  test("--only enables the named categories and disables the rest", () => {
    const config = buildConfig(options(["--only", "correctness"]));
    expect(config.categories).toEqual({
      correctness: true,
      suspicious: false,
      optimization: false,
      portability: false,
      style: false,
    });
  });

  test("--disable-category wins over --only for the same category", () => {
    const config = buildConfig(
      options(["--only", "correctness,style", "--disable-category", "style"]),
    );
    expect(config.categories).toMatchObject({
      correctness: true,
      style: false,
    });
  });

  test("presets accumulate over the defaults without duplicating", () => {
    const config = buildConfig(
      options(["--preset", "style", "--preset", "recommended"]),
      { presets: ["style"] },
    );
    expect([...(config.presets ?? [])].sort()).toEqual([
      "recommended",
      "style",
    ]);
  });
});

describe("failsThreshold", () => {
  test("fails on the threshold severity and anything more severe", () => {
    expect(failsThreshold([at("error")], "error")).toBe(true);
    expect(failsThreshold([at("error")], "warning")).toBe(true);
    expect(failsThreshold([at("warning")], "warning")).toBe(true);
  });

  test("passes when every finding is less severe than the threshold", () => {
    expect(failsThreshold([at("warning"), at("suggestion")], "error")).toBe(
      false,
    );
    expect(failsThreshold([], "info")).toBe(false);
  });
});

describe("inputRoot", () => {
  test("is the common ancestor of the inputs, not the working directory", () => {
    expect(inputRoot(["/game/src/a.s", "/game/src/b.s"], "/elsewhere")).toBe(
      "/game/src",
    );
    expect(inputRoot(["/game/src/a.s", "/game/data/b.s"], "/elsewhere")).toBe(
      "/game",
    );
  });

  test("falls back when there are no inputs or no shared prefix", () => {
    expect(inputRoot([], "/fallback")).toBe("/fallback");
  });
});

describe("run", () => {
  test("reports a finding and still exits 0 below the failure threshold", async () => {
    const { file } = await fixture();
    const { code, out } = await capture(["--no-config", "--no-color", file]);
    expect(out).toContain("optimization/prefer-moveq");
    expect(code).toBe(0);
  });

  test("exits 1 when --fail-on is lowered to the finding's severity", async () => {
    const { file } = await fixture();
    expect(
      (
        await capture([
          "--no-config",
          "--no-color",
          "--fail-on",
          "suggestion",
          file,
        ])
      ).code,
    ).toBe(1);
  });

  test("exits 0 for a file with nothing to report", async () => {
    const { file } = await fixture("start:\n\tmoveq\t#1,d0\n\trts\n");
    const { code, out } = await capture([
      "--no-config",
      "--no-color",
      "--fail-on",
      "suggestion",
      file,
    ]);
    expect(out).toBe("");
    expect(code).toBe(0);
  });

  test("--format json emits the package version and one entry per file", async () => {
    const { file } = await fixture();
    const { code, out } = await capture([
      "--no-config",
      "--format",
      "json",
      file,
    ]);
    const report = JSON.parse(out) as {
      version: string;
      files: { path: string; diagnostics: unknown[] }[];
    };
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      version: string;
    };
    expect(report.version).toBe(manifest.version);
    expect(report.files).toHaveLength(1);
    expect(report.files[0].path).toBe(file);
    expect(code).toBe(0);
  });

  test("--fix rewrites the file, and --fix-dry-run leaves it alone", async () => {
    const original = "start:\n\tmove.l\t#1,d0\n\trts\n";
    const dry = await fixture(original);
    await capture(["--no-config", "--no-color", "--fix-dry-run", dry.file]);
    expect(await readFile(dry.file, "utf8")).toBe(original);

    const wet = await fixture(original);
    await capture(["--no-config", "--no-color", "--fix", wet.file]);
    const fixed = await readFile(wet.file, "utf8");
    expect(fixed).not.toBe(original);
    expect(fixed).toContain("moveq");
  });

  test("--list-rules prints one line per rule and exits 0", async () => {
    const { code, out } = await capture(["--list-rules"]);
    const lines = out.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(100);
    expect(lines.every((line) => line.split("\t").length >= 4)).toBe(true);
    expect(code).toBe(0);
  });

  test("--version prints the version alone", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      version: string;
    };
    const { code, out } = await capture(["--version"]);
    expect(out).toBe(manifest.version);
    expect(code).toBe(0);
  });

  test("--help prints usage and exits 0", async () => {
    const { code, out } = await capture(["--help"]);
    expect(out).toContain("Usage:");
    expect(code).toBe(0);
  });

  test("a usage error exits 2 with the message and the help text", async () => {
    const bad = await capture(["--nope"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("Unknown option '--nope'");
    expect(bad.err).toContain("Usage:");

    // Nothing to lint, and no config to supply include patterns.
    const empty = await capture(["--no-config"]);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain("no input files");

    const conflicting = await capture([
      "--no-config",
      "--config",
      "m68k-lint.json",
      "x.s",
    ]);
    expect(conflicting.code).toBe(2);
    expect(conflicting.err).toContain(
      "--config cannot be combined with --no-config",
    );
  });

  test("exits 2 when a directory matches no assembly files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m68k-lint-empty-"));
    await writeFile(join(dir, "notes.txt"), "nothing here", "utf8");
    const { code, err } = await capture(["--no-config", dir]);
    expect(code).toBe(2);
    expect(err).toContain("no matching assembly files");
  });

  test("names a missing input rather than reporting it as a clean file", async () => {
    // Discovery rejects the path, so this never reaches the linter: an absent
    // file must not be mistaken for one with nothing to report.
    const dir = await mkdtemp(join(tmpdir(), "m68k-lint-missing-"));
    const missing = join(dir, "absent.s");
    const { code, err } = await capture(["--no-config", "--no-color", missing]);
    expect(err).toContain(`Input path does not exist: ${missing}`);
    expect(code).toBe(2);
  });
});

test("annotation precedence is CLI, project, then obfuscated", () => {
  expect(buildConfig(options()).fixAnnotate).toBe("obfuscated");
  expect(buildConfig(options(), { fixAnnotate: "all" }).fixAnnotate).toBe(
    "all",
  );
  expect(
    buildConfig(options(["--fix-annotate", "none"]), { fixAnnotate: "all" })
      .fixAnnotate,
  ).toBe("none");
});

describe("files the project ignores", () => {
  /** A system header the project borrows from, and a source that uses it. */
  async function project(ignores: string[]) {
    const dir = await mkdtemp(join(tmpdir(), "m68k-lint-ignored-"));
    await mkdir(join(dir, "sys"));
    await writeFile(
      join(dir, "sys", "hw.i"),
      "HW_ONE equ 1\nHW_UNUSED equ 2\n",
      "utf8",
    );
    await writeFile(
      join(dir, "main.s"),
      "main:\n\tmove.l\t#HW_ONE,d0\n\trts\n",
      "utf8",
    );
    await writeFile(
      join(dir, "m68k-lint.json"),
      JSON.stringify({ ignores }),
      "utf8",
    );
    return dir;
  }
  // The config is named outright: the CLI looks for one from where it is run,
  // not from the file it is given.
  const args = (dir: string) => [
    "--config",
    join(dir, "m68k-lint.json"),
    "--rule",
    "suspicious/unused-constant=warning",
    dir,
  ];

  test("are not reported on", async () => {
    const dir = await project(["sys/**"]);
    const { out } = await capture(args(dir));
    expect(out).not.toContain("HW_UNUSED");
  });

  test("are still read, so their constants resolve", async () => {
    const dir = await project(["sys/**"]);
    const { out } = await capture(args(dir));
    // The constant only resolves if the ignored header was indexed.
    expect(out).toContain("HW_ONE = 1");
    expect(out).toContain("sys/hw.i");
  });

  test("would be reported on if they were not ignored", async () => {
    // The control: the rule does fire on the header, so silence above is the
    // ignore pattern at work rather than the rule finding nothing.
    const dir = await project([]);
    const { out } = await capture(args(dir));
    expect(out).toContain("HW_UNUSED");
  });
});

describe("includes outside the project", () => {
  /**
   * A project in `proj/` that includes `hw.i`, which lives in a sibling
   * directory the source does not say how to reach.
   */
  async function workspace(config: object, include = "hw.i") {
    const dir = await mkdtemp(join(tmpdir(), "m68k-lint-external-"));
    await mkdir(join(dir, "proj"));
    await mkdir(join(dir, "shared"));
    await writeFile(
      join(dir, "shared", "hw.i"),
      "HW_ONE equ 1\nHW_UNUSED equ 2\n",
      "utf8",
    );
    await writeFile(
      join(dir, "proj", "main.s"),
      `\tinclude "${include}"\nmain:\n\tmove.l\t#HW_ONE,d0\n\trts\n`,
      "utf8",
    );
    await writeFile(
      join(dir, "proj", "m68k-lint.json"),
      JSON.stringify(config),
      "utf8",
    );
    return join(dir, "proj");
  }
  const lint = (proj: string) =>
    capture([
      "--config",
      join(proj, "m68k-lint.json"),
      "--rule",
      "suspicious/unused-constant=warning",
      proj,
    ]);

  test("are read through the config's include paths", async () => {
    const proj = await workspace({ includePaths: ["../shared"] });
    const { out } = await lint(proj);
    // The constant only resolves if the file outside the project was read.
    expect(out).toContain("HW_ONE = 1");
    expect(out).toContain("../shared/hw.i");
  });

  test("are not found without the include path", async () => {
    // The control: the same project with nothing saying where hw.i is.
    const proj = await workspace({});
    const { out } = await lint(proj);
    expect(out).not.toContain("HW_ONE = 1");
  });

  test("are found in the case the file system finds them in", async () => {
    // Case is the operating system's business, as it would be for the
    // assembler run there: found on a case-insensitive one, not on Linux.
    const proj = await workspace({ includePaths: ["../shared"] }, "HW.I");
    const dir = join(proj, "..", "shared");
    const insensitive = existsSync(join(dir, "HW.I"));
    const { out } = await lint(proj);
    expect(out.includes("HW_ONE = 1")).toBe(insensitive);
  });

  test("are found when the include names its way there", async () => {
    const proj = await workspace({}, "../shared/hw.i");
    const { out } = await lint(proj);
    expect(out).toContain("HW_ONE = 1");
  });

  test("are read but never linted", async () => {
    const proj = await workspace({ includePaths: ["../shared"] });
    const { out } = await lint(proj);
    // hw.i defines a constant nothing uses, and is outside the project: it
    // provides symbols and gets no findings of its own.
    expect(out).not.toContain("HW_UNUSED");
  });

  test("count as references from the project", async () => {
    const proj = await workspace({ includePaths: ["../shared"] });
    // Read from the project's own file, the constant is used, so it is not
    // reported even if the index also read the file that defines it.
    const { out } = await lint(proj);
    expect(out).not.toContain("HW_ONE' is not referenced");
  });
});

describe("an include in the wrong case", () => {
  /**
   * A project whose `main.s` includes `HW.I` while the file is `hw.i`. Only a
   * file system that ignores case resolves it, which is the situation the rule
   * is for; on one that does not, the assembler itself would object.
   */
  async function project() {
    const dir = await mkdtemp(join(tmpdir(), "m68k-lint-case-"));
    await writeFile(join(dir, "hw.i"), "HW_ONE equ 1\n", "utf8");
    await writeFile(
      join(dir, "main.s"),
      '\tinclude "HW.I"\nmain:\n\trts\n',
      "utf8",
    );
    await writeFile(join(dir, "m68k-lint.json"), "{}", "utf8");
    return dir;
  }

  test("is reported where the file system lets it through", async () => {
    const dir = await project();
    const insensitive = existsSync(join(dir, "HW.I"));
    const { out } = await capture([
      "--config",
      join(dir, "m68k-lint.json"),
      join(dir, "main.s"),
    ]);
    // Reported exactly when the file system resolved it. Where it did not, that
    // is the assembler's to report and this stays quiet.
    expect(out.includes("portability/include-case")).toBe(insensitive);
    if (insensitive) expect(out).toContain("'HW.I' is 'hw.i' on disk");
  });

  test("is not reported when the rule is off", async () => {
    const dir = await project();
    const { out } = await capture([
      "--config",
      join(dir, "m68k-lint.json"),
      "--rule",
      "portability/include-case=off",
      join(dir, "main.s"),
    ]);
    expect(out).not.toContain("portability/include-case");
  });
});
