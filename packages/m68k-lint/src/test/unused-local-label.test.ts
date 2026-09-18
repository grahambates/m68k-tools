import { lintSource } from "../core/lint.js";
import { ids, lint } from "./helpers.js";

describe("suspicious/unused-local-label", () => {
  test("flags a local label nothing branches to", () => {
    const source = ["start:", "moveq #0,d0", ".loop:", "rts"].join("\n");
    expect(ids(source)).toContain("suspicious/unused-local-label");
  });

  test("does not flag a local label used as a branch target", () => {
    const source = [
      "start:",
      ".loop:",
      "subq.l #1,d0",
      "bne .loop",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain("suspicious/unused-local-label");
  });

  test("does not flag a local label only referenced from a data table", () => {
    const source = [
      "start:",
      "lea .table(pc),a0",
      "rts",
      ".table:",
      "dc.l .case0,.case1",
      ".case0:",
      "rts",
      ".case1:",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain("suspicious/unused-local-label");
  });

  test("never flags a global label, even when unused", () => {
    const source = ["start:", "moveq #0,d0", "unused_global:", "rts"].join(
      "\n",
    );
    expect(ids(source)).not.toContain("suspicious/unused-local-label");
  });

  test("does not flag a $-suffixed local label that is referenced", () => {
    const source = ["loop$:", "subq.l #1,d0", "bne loop$", "rts"].join("\n");
    expect(ids(source)).not.toContain("suspicious/unused-local-label");
  });

  test("skips labels defined inside a macro body", () => {
    // Written with real tabs rather than through the shared `fixture` helper:
    // `macro` is not in its column-zero allowlist, so an auto-indented header
    // would stop this being recognised as a macro definition at all.
    const source = [
      "mymacro macro",
      ".loop:",
      "\tnop",
      "\tendm",
      "start:",
      "\tmymacro",
      "\trts",
    ].join("\n");
    const diagnostics = lintSource(source, { processors: ["mc68000"] });
    expect(diagnostics.map((d) => d.ruleId)).not.toContain(
      "suspicious/unused-local-label",
    );
  });

  test("reports the label name and points at the label", () => {
    const source = ["start:", "moveq #0,d0", ".dead:", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "suspicious/unused-local-label",
    );
    expect(diagnostic?.message).toContain(".dead");
    expect(diagnostic?.message).toContain("start");
    expect(diagnostic?.suggestion?.applicability).toBe("manual");
  });

  test("one routine's used .loop does not hide another routine's unused .loop", () => {
    const source = [
      "routineA:",
      ".loop:",
      "subq.l #1,d0",
      "bne .loop",
      "rts",
      "routineB:",
      "moveq #0,d0",
      ".loop:",
      "rts",
    ].join("\n");
    const diagnostics = lint(source).filter(
      (d) => d.ruleId === "suspicious/unused-local-label",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.loc.line).toBe(8);
    expect(diagnostics[0]?.message).toContain("routineB");
  });

  test("a reference in one routine does not satisfy the same-named label in another", () => {
    const source = [
      "routineA:",
      ".loop:",
      "bra .loop",
      "routineB:",
      ".loop:",
      "bra .loop",
    ].join("\n");
    expect(
      lint(source).filter((d) => d.ruleId === "suspicious/unused-local-label"),
    ).toHaveLength(0);
  });
});
