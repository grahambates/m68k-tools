import { buildProjectReferences } from "../analysis/project-references.js";
import { lintSource } from "../core/lint.js";
import type { LintConfig } from "../core/config.js";
import { fixture } from "./helpers.js";

const RULE_ID = "suspicious/unused-global-label";

const ENABLED: LintConfig = {
  processors: ["mc68000"],
  rules: { [RULE_ID]: "warning" },
};

const references = (files: Record<string, string>) =>
  buildProjectReferences(
    Object.entries(files).map(([path, source]) => ({
      path,
      source: fixture(source),
    })),
  );

const lint = (
  source: string,
  config: LintConfig,
  files?: Record<string, string>,
) =>
  lintSource(
    fixture(source),
    config,
    undefined,
    undefined,
    files ? references(files) : undefined,
  ).map((d) => d.ruleId);

describe("suspicious/unused-global-label", () => {
  test("is off by default", () => {
    const source = ["start:", "moveq #0,d0", "rts"].join("\n");
    expect(
      lint(source, { processors: ["mc68000"] }, { "main.s": source }),
    ).not.toContain(RULE_ID);
  });

  test("does nothing without a project-wide reference index", () => {
    const source = ["start:", "moveq #0,d0", "unused:", "rts"].join("\n");
    expect(lint(source, ENABLED)).not.toContain(RULE_ID);
  });

  test("flags a global label referenced nowhere in the project", () => {
    const source = ["start:", "moveq #0,d0", "unused:", "rts"].join("\n");
    expect(lint(source, ENABLED, { "main.s": source })).toContain(RULE_ID);
  });

  test("does not flag a label called from within the same file", () => {
    // `start` is exported so it is not itself the thing under test: without
    // some caller, an entry point with nothing calling it is exactly what
    // this rule is supposed to flag.
    const source = [
      "xdef start",
      "start:",
      "bsr helper",
      "rts",
      "helper:",
      "rts",
    ].join("\n");
    expect(lint(source, ENABLED, { "main.s": source })).not.toContain(RULE_ID);
  });

  test("does not flag a label only called from another file in the project", () => {
    const main = ["start:", "bsr helper", "rts"].join("\n");
    const lib = ["helper:", "rts"].join("\n");
    expect(lint(lib, ENABLED, { "main.s": main, "lib.s": lib })).not.toContain(
      RULE_ID,
    );
  });

  test("does not flag a label exported with XDEF, even if unreferenced", () => {
    const source = ["xdef entry", "entry:", "rts"].join("\n");
    expect(lint(source, ENABLED, { "main.s": source })).not.toContain(RULE_ID);
  });

  test("does not flag a label imported with XREF from another file", () => {
    const lib = ["callback:", "rts"].join("\n");
    const main = ["xref callback", "start:", "rts"].join("\n");
    expect(lint(lib, ENABLED, { "main.s": main, "lib.s": lib })).not.toContain(
      RULE_ID,
    );
  });

  test("never flags _start, the conventional linker entry point", () => {
    const source = ["_start:", "moveq #0,d0", "rts"].join("\n");
    expect(lint(source, ENABLED, { "main.s": source })).not.toContain(RULE_ID);
  });

  test("never flags a local label", () => {
    const source = ["xdef start", "start:", ".loop:", "bra .loop"].join("\n");
    expect(lint(source, ENABLED, { "main.s": source })).not.toContain(RULE_ID);
  });

  test("skips a label defined inside a macro body", () => {
    // Written with real tabs rather than through the fixture helper: `macro`
    // is not in its column-zero allowlist, so an auto-indented header would
    // stop this being recognised as a macro definition at all.
    const source = [
      "mymacro macro",
      "entry:",
      "\tnop",
      "\tendm",
      "\txdef start",
      "start:",
      "\tmymacro",
      "\trts",
    ].join("\n");
    const found = lintSource(
      source,
      ENABLED,
      undefined,
      undefined,
      buildProjectReferences([{ path: "main.s", source }]),
    ).map((d) => d.ruleId);
    expect(found).not.toContain(RULE_ID);
  });
});
