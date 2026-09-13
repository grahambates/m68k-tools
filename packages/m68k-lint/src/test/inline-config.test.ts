import { defaultConfig } from "../core/config.js";
import { lintSource } from "../core/lint.js";

function hasRule(source: string, ruleId: string, inlineConfig = true): boolean {
  return lintSource(source, { ...defaultConfig, inlineConfig }).some(
    (d) => d.ruleId === ruleId,
  );
}

describe("inline configuration directives", () => {
  const rule = "optimization/prefer-moveq";

  test("disable-next-line suppresses one rule on the following physical line", () => {
    const source = [
      `; m68k-lint-disable-next-line ${rule}`,
      "  move.l #42,d0",
      "  move.l #43,d1",
    ].join("\n");
    const matches = lintSource(source, defaultConfig).filter(
      (d) => d.ruleId === rule,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].loc.line).toBe(3);
  });

  test("recognises a column-zero star comment, the Devpac/AsmOne full-line form", () => {
    const source = [`* m68k-lint-disable ${rule}`, "  move.l #42,d0"].join(
      "\n",
    );
    expect(hasRule(source, rule)).toBe(false);
  });

  test("star directives obey the same next-line scope as semicolon ones", () => {
    const source = [
      `* m68k-lint-disable-next-line ${rule}`,
      "  move.l #42,d0",
      "  move.l #43,d1",
    ].join("\n");
    const matches = lintSource(source, defaultConfig).filter(
      (d) => d.ruleId === rule,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].loc.line).toBe(3);
  });

  test("a star away from column zero is arithmetic, not a comment", () => {
    // `2*21` must not be read as a directive-bearing comment.
    expect(
      hasRule(`  move.l #2*21,d0 ; m68k-lint-disable-line ${rule}`, rule),
    ).toBe(false);
    expect(hasRule("  move.l #2*21,d0", rule)).toBe(true);
  });

  test("disable-line suppresses a trailing-comment diagnostic", () => {
    expect(
      hasRule(`  move.l #42,d0 ; m68k-lint-disable-line ${rule}`, rule),
    ).toBe(false);
  });

  test("disable and enable establish file/range scope", () => {
    const source = [
      `; m68k-lint-disable ${rule}`,
      "  move.l #42,d0",
      `; m68k-lint-enable ${rule}`,
      "  move.l #43,d1",
    ].join("\n");
    const matches = lintSource(source, defaultConfig).filter(
      (d) => d.ruleId === rule,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].loc.line).toBe(4);
  });

  test("bare disable-next-line suppresses all rules", () => {
    const source = [
      "; m68k-lint-disable-next-line -- deliberate code shape",
      "  move.l #42,d0",
    ].join("\n");
    expect(lintSource(source, defaultConfig)).toHaveLength(0);
  });

  test("multiple rule IDs may be comma separated", () => {
    const source = [
      "; m68k-lint-disable optimization/prefer-moveq, suspicious/self-move",
      "  move.l #42,d0",
      "  move.l d1,d1",
    ].join("\n");
    const ids = lintSource(source, defaultConfig).map((d) => d.ruleId);
    expect(ids).not.toContain("optimization/prefer-moveq");
    expect(ids).not.toContain("suspicious/self-move");
  });

  test("inlineConfig=false ignores source directives", () => {
    const source = [
      `; m68k-lint-disable-next-line ${rule}`,
      "  move.l #42,d0",
    ].join("\n");
    expect(hasRule(source, rule, false)).toBe(true);
  });

  test("semicolon inside a string is not treated as a directive comment", () => {
    const source = `  dc.b "; m68k-lint-disable ${rule}"\n  move.l #42,d0`;
    expect(hasRule(source, rule)).toBe(true);
  });
});
