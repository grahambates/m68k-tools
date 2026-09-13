import { readFileSync } from "node:fs";
import { parseArgs, usage, type CliOptions } from "../cli/args.js";
import { VERSION } from "../cli/version.js";

/** parseArgs returns a union; every test here expects a parsed option set. */
function parse(argv: string[], isTTY = false): CliOptions {
  const result = parseArgs(argv, isTTY);
  if (result === "help" || result === "version")
    throw new Error(`expected options, got '${result}'`);
  return result;
}

describe("CLI version", () => {
  test("is the version in package.json", () => {
    // The version was hardcoded in the CLI and sat at 0.46.2 across two
    // releases. Read package.json by a different route than the CLI does, so
    // this fails if the relative URL ever resolves to the wrong manifest.
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(manifest.version);
  });

  test("appears in the usage header", () => {
    expect(usage().startsWith(`m68k-lint ${VERSION}\n`)).toBe(true);
  });
});

describe("usage text", () => {
  test("documents every option the parser accepts", () => {
    const text = usage();
    const documented = new Set(text.match(/--[a-z0-9-]+/g) ?? []);
    // Read the long-form flags straight out of the parser source, so a new
    // option cannot be added without a line in the help.
    const source = readFileSync("src/cli/args.ts", "utf8");
    const body = source.slice(source.indexOf("export function parseArgs"));
    const accepted = new Set(
      body.match(/arg === "(--[a-z0-9-]+)"/g)?.map((m) => m.slice(9, -1)) ?? [],
    );
    expect([...accepted].filter((flag) => !documented.has(flag))).toEqual([]);
  });
});

describe("parseArgs", () => {
  test("treats bare arguments as input paths", () => {
    expect(parse(["game.s", "src/"]).files).toEqual(["game.s", "src/"]);
  });

  test("returns help and version rather than printing them", () => {
    expect(parseArgs(["-h"])).toBe("help");
    expect(parseArgs(["--help"])).toBe("help");
    expect(parseArgs(["-v"])).toBe("version");
    expect(parseArgs(["--version"])).toBe("version");
  });

  test("stops at help even when other options precede it", () => {
    expect(parseArgs(["--fix", "--help", "game.s"])).toBe("help");
  });

  test("rejects an unknown option rather than treating it as a path", () => {
    expect(() => parse(["--nope"])).toThrow("Unknown option '--nope'");
  });

  test("rejects an option whose value is missing", () => {
    expect(() => parse(["--cpu"])).toThrow("--cpu requires a value");
    // A following option is not a value: `--cpu --fix` is a missing value.
    expect(() => parse(["--cpu", "--fix"])).toThrow("--cpu requires a value");
  });

  test("parses comma-separated processors and rejects unknown ones", () => {
    expect(parse(["--cpu", "mc68000,mc68020"]).processors).toEqual([
      "mc68000",
      "mc68020",
    ]);
    expect(() => parse(["--cpu", "z80"])).toThrow("unknown value 'z80'");
  });

  test("validates single-value enums", () => {
    expect(parse(["--platform", "amiga"]).platform).toBe("amiga");
    expect(() => parse(["--platform", "spectrum"])).toThrow(
      "--platform must be one of",
    );
    expect(parse(["--goal", "size"]).goal).toBe("size");
    expect(() => parse(["--goal", "fast"])).toThrow(
      "--goal must be balanced, speed, or size",
    );
    expect(parse(["--format", "json"]).format).toBe("json");
    expect(() => parse(["--format", "xml"])).toThrow(
      "--format must be 'pretty' or 'json'",
    );
    expect(parse(["--fail-on", "warning"]).failOn).toBe("warning");
    expect(() => parse(["--fail-on", "nit"])).toThrow("--fail-on must be");
  });

  test("splits a rule override on the last '=' so rule ids may contain one", () => {
    expect(parse(["--rule", "suspicious/nop=warning"]).rules).toEqual({
      "suspicious/nop": "warning",
    });
    expect(() => parse(["--rule", "suspicious/nop"])).toThrow(
      "--rule expects <rule-id>=<setting>",
    );
    expect(() => parse(["--rule", "=warning"])).toThrow(
      "--rule expects <rule-id>=<setting>",
    );
    expect(() => parse(["--rule", "suspicious/nop=loud"])).toThrow(
      "Unknown rule setting 'loud'",
    );
  });

  test("accumulates repeatable options", () => {
    const options = parse([
      "--ignore-pattern",
      "vendor/**",
      "--ignore-pattern",
      "build/**",
    ]);
    expect(options.ignorePatterns).toEqual(["vendor/**", "build/**"]);
    expect(
      parse(["--preset", "recommended", "--preset", "style"]).presets,
    ).toEqual(["recommended", "style"]);
    expect(
      parse([
        "--disable-category",
        "style",
        "--disable-category",
        "optimization",
      ]).disabledCategories,
    ).toEqual(["style", "optimization"]);
  });

  test("merges and normalizes extensions across repeated --ext", () => {
    expect(parse(["--ext", "s,asm", "--ext", ".inc"]).extensions).toEqual([
      ".s",
      ".asm",
      ".inc",
    ]);
  });

  test("each fix mode implies a fixing run, and dry-run does not write", () => {
    expect(parse(["--fix"])).toMatchObject({
      fix: true,
      fixConditional: false,
      fixDryRun: false,
    });
    expect(parse(["--fix-conditional"])).toMatchObject({
      fix: true,
      fixConditional: true,
    });
    expect(parse(["--fix-annotate"])).toMatchObject({
      fix: true,
      fixAnnotate: true,
    });
    expect(parse(["--fix-dry-run"])).toMatchObject({
      fix: true,
      fixDryRun: true,
    });
    // Interactive is its own path and does not set the batch fix flag.
    expect(parse(["-i"])).toMatchObject({ fixInteractive: true, fix: false });
  });

  test("boolean pairs let the later flag win", () => {
    expect(parse(["--impact", "--no-impact"]).measureImpact).toBe(false);
    expect(parse(["--no-impact", "--impact"]).measureImpact).toBe(true);
    expect(parse(["--no-inline-config", "--inline-config"]).inlineConfig).toBe(
      true,
    );
    // Left unset so the config file still gets a say.
    expect(parse([]).measureImpact).toBeUndefined();
    expect(parse([]).inlineConfig).toBeUndefined();
  });

  test("colour follows the terminal unless forced either way", () => {
    expect(parse([], false).color).toBe(false);
    expect(parse(["--color"], false).color).toBe(true);
    expect(parse(["--no-color"], true).color).toBe(false);
  });

  test("--only records the categories to keep", () => {
    expect(parse(["--only", "correctness,suspicious"]).onlyCategories).toEqual([
      "correctness",
      "suspicious",
    ]);
    expect(parse([]).onlyCategories).toBeUndefined();
    expect(() => parse(["--only", "perf"])).toThrow("unknown value 'perf'");
  });
});
