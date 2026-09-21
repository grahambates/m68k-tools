import { lintSource } from "../core/lint.js";
import { conditionalAssembly } from "../analysis/conditionals.js";
import type { LintConfig } from "../core/config.js";
import { fixtureContext } from "./helpers.js";

const config: LintConfig = { processors: ["mc68000"] };
const lint = (source: string, rules: LintConfig["rules"] = {}) =>
  lintSource(source, { ...config, rules });
const ids = (source: string, rules?: LintConfig["rules"]) =>
  lint(source, rules).map((d) => d.ruleId);

describe("iif", () => {
  test("its statement is analysed like any other", () => {
    const found = lint("\tiif DEBUG move.l #1,d0").find(
      (d) => d.ruleId === "optimization/prefer-moveq",
    );
    expect(found).toBeDefined();
  });

  test("a rewrite keeps the label, the condition and the comment", () => {
    const found = lint("start\tiif DEBUG move.l #1,d0 ; note").find(
      (d) => d.ruleId === "optimization/prefer-moveq",
    );
    expect(found?.suggestion?.replacement).toBe(
      "start\tiif DEBUG moveq #1,d0 ; note",
    );
  });

  test("a statement whose condition is known not to hold is left out", () => {
    const left = (source: string) =>
      conditionalAssembly(fixtureContext(source).file).unassembled;
    expect(left("\tiif 0 nop")[0]).toBe(true);
    expect(left("\tiif 1 nop")[0]).toBe(false);
    // Unknown: kept.
    expect(left("\tiif DEBUG nop")[0]).toBe(false);
  });

  test("what it writes may not happen, so an earlier write is not dead", () => {
    const rule = { "suspicious/dead-register-write": "warning" as const };
    const conditional = [
      "\tmoveq #0,d0",
      "\tiif DEBUG moveq #1,d0",
      "\tmove.l d0,d1",
      "\trts",
    ].join("\n");
    expect(ids(conditional, rule)).not.toContain(
      "suspicious/dead-register-write",
    );
    // The same without the condition, where the first write is overwritten.
    const plain = conditional.replace("iif DEBUG ", "");
    expect(ids(plain, rule)).toContain("suspicious/dead-register-write");
  });

  test("it is not joined to the lines beside it", () => {
    const source = ["\tiif DEBUG addq.l #1,d0", "\taddq.l #2,d0"].join("\n");
    expect(ids(source)).not.toContain("optimization/combine-consecutive-addq");
    expect(ids(source.replace("iif DEBUG ", ""))).toContain(
      "optimization/combine-consecutive-addq",
    );
  });

  test("a conditional return leaves the code after it reachable", () => {
    const source = ["\tiif DEBUG rts", "\tmoveq #1,d0", "\trts"].join("\n");
    expect(
      ids(source, { "suspicious/unreachable-code": "warning" }),
    ).not.toContain("suspicious/unreachable-code");
    const plain = source.replace("iif DEBUG ", "");
    expect(ids(plain, { "suspicious/unreachable-code": "warning" })).toContain(
      "suspicious/unreachable-code",
    );
  });

  test("a replacement that would span lines is left as a suggestion", () => {
    // Removing the conditional statement outright is not offered as a rewrite.
    const found = lint("\tiif DEBUG lea (a0),a0").find(
      (d) => d.ruleId === "optimization/redundant-lea",
    );
    expect(found?.suggestion?.replacement).toBeUndefined();
  });
});
