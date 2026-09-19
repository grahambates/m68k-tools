import { buildProjectReferences } from "../analysis/project-references.js";
import { lintSource } from "../core/lint.js";
import type { LintConfig } from "../core/config.js";
import { fixture } from "./helpers.js";

const RULE_ID = "suspicious/unused-macro";

const ENABLED: LintConfig = {
  processors: ["mc68000"],
  rules: { [RULE_ID]: "warning" },
};

const references = (files: Record<string, string>, caseSensitive?: boolean) =>
  buildProjectReferences(
    Object.entries(files).map(([path, source]) => ({
      path,
      source: fixture(source),
    })),
    { caseSensitive },
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
    files ? references(files, config.caseSensitive) : undefined,
  );

const ids = (...args: Parameters<typeof lint>) =>
  lint(...args).map((d) => d.ruleId);

describe("suspicious/unused-macro", () => {
  test("is off by default", () => {
    const source = ["macro PUSH", "move.l \\1,-(sp)", "endm"].join("\n");
    expect(
      ids(source, { processors: ["mc68000"] }, { "main.s": source }),
    ).not.toContain(RULE_ID);
  });

  test("does nothing without a project-wide reference index", () => {
    const source = ["macro PUSH", "move.l \\1,-(sp)", "endm"].join("\n");
    expect(ids(source, ENABLED)).not.toContain(RULE_ID);
  });

  test("flags a macro invoked nowhere, in either definition form", () => {
    const a = ["macro PUSH", "move.l \\1,-(sp)", "endm"].join("\n");
    const b = ["WAIT: macro", "nop", "endm"].join("\n");
    const found = (source: string) =>
      lint(source, ENABLED, { "main.s": source }).filter(
        (d) => d.ruleId === RULE_ID,
      );
    expect(found(a)).toHaveLength(1);
    expect(found(a)[0].message).toContain("'PUSH'");
    expect(found(b)).toHaveLength(1);
    expect(found(b)[0].message).toContain("'WAIT'");
  });

  test("does not flag a macro invoked in the same file", () => {
    const source = [
      "macro PUSH",
      "move.l \\1,-(sp)",
      "endm",
      "start:",
      "PUSH d0",
      "rts",
    ].join("\n");
    expect(ids(source, ENABLED, { "main.s": source })).not.toContain(RULE_ID);
  });

  test("does not match an invocation in another case by default", () => {
    const source = [
      "macro PUSH",
      "move.l \\1,-(sp)",
      "endm",
      "start:",
      "push d0",
      "rts",
    ].join("\n");
    // Macro names keep case as symbols do, so `push` is not a call to PUSH.
    expect(ids(source, ENABLED, { "main.s": source })).toContain(RULE_ID);
  });

  test("matches an invocation in another case when case is folded", () => {
    const source = [
      "macro PUSH",
      "move.l \\1,-(sp)",
      "endm",
      "start:",
      "push d0",
      "rts",
    ].join("\n");
    const folded: LintConfig = { ...ENABLED, caseSensitive: false };
    const files = { "main.s": source };
    expect(lint(source, folded, files).map((d) => d.ruleId)).not.toContain(
      RULE_ID,
    );
  });

  test("does not flag a macro invoked from another file", () => {
    const lib = ["macro PUSH", "move.l \\1,-(sp)", "endm"].join("\n");
    const main = ["start:", "PUSH d0", "rts"].join("\n");
    expect(ids(lib, ENABLED, { "lib.i": lib, "main.s": main })).not.toContain(
      RULE_ID,
    );
  });

  test("counts an invocation from inside another macro", () => {
    const source = [
      "macro INNER",
      "nop",
      "endm",
      "macro OUTER",
      "INNER",
      "endm",
      "start:",
      "OUTER",
      "rts",
    ].join("\n");
    const d = lint(source, ENABLED, { "main.s": source }).filter(
      (x) => x.ruleId === RULE_ID,
    );
    expect(d).toHaveLength(0);
  });

  test("a macro is not also reported as an unused global label", () => {
    const source = ["WAIT: macro", "nop", "endm"].join("\n");
    const config: LintConfig = {
      processors: ["mc68000"],
      rules: {
        [RULE_ID]: "warning",
        "suspicious/unused-global-label": "warning",
      },
    };
    const d = lint(source, config, { "main.s": source });
    expect(d.map((x) => x.ruleId)).toEqual([RULE_ID]);
  });
});
