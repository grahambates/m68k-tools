import { buildProjectReferences } from "../analysis/project-references.js";
import { lintSource } from "../core/lint.js";
import type { LintConfig } from "../core/config.js";
import { fixture } from "./helpers.js";

const RULE_ID = "suspicious/unused-constant";

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

describe("suspicious/unused-constant", () => {
  test("is off by default", () => {
    const source = "FOO equ 1";
    expect(
      lint(source, { processors: ["mc68000"] }, { "main.s": source }),
    ).not.toContain(RULE_ID);
  });

  test("does nothing without a project-wide reference index", () => {
    const source = "FOO equ 1";
    expect(lint(source, ENABLED)).not.toContain(RULE_ID);
  });

  test("flags a constant referenced nowhere in the project", () => {
    const source = "FOO equ 1";
    expect(lint(source, ENABLED, { "main.s": source })).toContain(RULE_ID);
  });

  test("does not flag a constant used within the same file", () => {
    const source = ["FOO equ 1", "move.l #FOO,d0"].join("\n");
    expect(lint(source, ENABLED, { "main.s": source })).not.toContain(RULE_ID);
  });

  test("does not flag a constant only used from another file in the project", () => {
    const hw = "FOO equ 1";
    const main = "move.l #FOO,d0";
    expect(lint(hw, ENABLED, { "hw.i": hw, "main.s": main })).not.toContain(
      RULE_ID,
    );
  });

  test("does not flag a constant exported with XDEF, even if unreferenced", () => {
    const source = ["xdef FOO", "FOO equ 1"].join("\n");
    expect(lint(source, ENABLED, { "main.s": source })).not.toContain(RULE_ID);
  });

  test("does not flag a constant imported with XREF from another file", () => {
    const hw = "FOO equ 1";
    const main = "xref FOO";
    expect(lint(hw, ENABLED, { "hw.i": hw, "main.s": main })).not.toContain(
      RULE_ID,
    );
  });

  test("a constant used only to derive another constant still counts as used", () => {
    const source = ["BASE equ 40", "OFFSET equ BASE+2"].join("\n");
    const found = lint(source, ENABLED, { "main.s": source });
    // OFFSET is genuinely unused, but BASE fed into its definition.
    expect(found).toContain(RULE_ID);
    const diagnostic = lintSource(
      fixture(source),
      ENABLED,
      undefined,
      undefined,
      references({ "main.s": source }),
    ).find((d) => d.ruleId === RULE_ID);
    expect(diagnostic?.message).toContain("OFFSET");
    expect(diagnostic?.message).not.toContain("BASE");
  });

  test("skips a constant defined inconsistently in one file", () => {
    const source = ["FOO equ 1", "FOO equ 2"].join("\n");
    expect(lint(source, ENABLED, { "main.s": source })).not.toContain(RULE_ID);
  });

  test("skips a constant defined inside a macro body", () => {
    // Written with real tabs rather than through the fixture helper: `macro`
    // is not in its column-zero allowlist, so an auto-indented header would
    // stop this being recognised as a macro definition at all.
    const source = [
      "mymacro macro",
      "FOO equ 1",
      "\tendm",
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
