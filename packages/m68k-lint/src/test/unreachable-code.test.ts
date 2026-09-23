import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const RULE = "suspicious/unreachable-code";
const found = (source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === RULE,
  );

describe("suspicious/unreachable-code", () => {
  test("flags code after an unconditional branch", () => {
    const d = found(
      ["start:", "bra done", "moveq #1,d0", "done:", "rts"].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].loc.line).toBe(3);
  });

  test("reports a run once, with its length", () => {
    const d = found(
      ["start:", "rts", "moveq #1,d0", "moveq #2,d1", "addq.l #1,d0"].join(
        "\n",
      ),
    );
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("3 instructions");
  });

  test("code after a return with nothing pointing at it", () => {
    expect(found(["start:", "rts", "nop"].join("\n"))).toHaveLength(1);
  });

  test("a referenced local label makes the code reachable", () => {
    expect(
      found(
        ["start:", "beq .skip", "rts", ".skip:", "moveq #1,d0", "rts"].join(
          "\n",
        ),
      ),
    ).toHaveLength(0);
  });

  test("an unreferenced local label does not", () => {
    expect(
      found(["start:", "rts", ".dead:", "moveq #1,d0"].join("\n")),
    ).toHaveLength(1);
  });

  test("never flags code under a global label", () => {
    expect(
      found(["start:", "rts", "other:", "moveq #1,d0", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("an inline jump table is reached by the computed jump", () => {
    const source = [
      "dispatch:",
      "add.w d0,d0",
      "jmp table(pc,d0.w)",
      "table:",
      "bra.w case0",
      "bra.w case1",
      "case0:",
      "rts",
      "case1:",
      "rts",
    ].join("\n");
    expect(found(source)).toHaveLength(0);
  });

  test("unlabelled entries straight after a computed jump are not flagged", () => {
    const source = [
      "dispatch:",
      "jmp 2(pc,d0.w)",
      "bra.w case0",
      "bra.w case1",
      "case0:",
      "rts",
      "case1:",
      "rts",
    ].join("\n");
    expect(found(source)).toHaveLength(0);
  });

  test("code in the other arm of a conditional is not flagged", () => {
    const source = [
      "start:",
      "\tifd A",
      "\tbra start",
      "\telse",
      "\tnop",
      "\tendc",
      "\trts",
    ].join("\n");
    expect(found(source)).toHaveLength(0);
  });

  test("an unreferenced local label on dead code is reported once", () => {
    const d = lintSource(
      fixture(["start:", "rts", ".dead:", "moveq #1,d0"].join("\n")),
      {
        processors: ["mc68000"],
      },
    ).map((x) => x.ruleId);
    expect(d).toContain(RULE);
    expect(d).not.toContain("suspicious/unused-local-label");
  });

  test("the label is still reported if this rule is off", () => {
    const d = lintSource(
      fixture(["start:", "rts", ".dead:", "moveq #1,d0"].join("\n")),
      {
        processors: ["mc68000"],
        rules: { [RULE]: "off" },
      },
    ).map((x) => x.ruleId);
    expect(d).toContain("suspicious/unused-local-label");
  });

  // A single-arm conditional (`ifne`/`endc`, no `else`) whose condition
  // resolves false is not assembled at all: vasm never emits a branch, a
  // label or anything else inside it, so reachability inside the arm is not
  // a question this rule can answer -- and was wrongly answering "no". The
  // arm's first line was seeded as a fresh entry point (as any conditional
  // arm is, since the analysis cannot always tell whether control falls into
  // it), but the control-flow graph gives an unassembled line no successors,
  // so everything after that first line inside the arm looked unreachable.
  describe("an arm known not to be assembled", () => {
    const source = (flag: string) =>
      fixture(
        [
          "start:",
          "\ttst.w d0",
          `\tifne ${flag}`,
          "\tbtst.b #0,frame",
          "\tbeq .even",
          "\tsuba.w d2,a3",
          ".even:",
          "\tendc",
          "\ttst.w d1",
          "\trts",
        ].join("\n"),
      );

    test("is not checked for reachability at all", () => {
      const src = "FLAG equ 0\n" + source("FLAG");
      expect(
        lintSource(src, { processors: ["mc68000"] }).filter(
          (d) => d.ruleId === RULE,
        ),
      ).toHaveLength(0);
    });

    test("an arm that is assembled is still checked normally", () => {
      const src = "FLAG equ 1\n" + source("FLAG");
      expect(
        lintSource(src, { processors: ["mc68000"] }).filter(
          (d) => d.ruleId === RULE,
        ),
      ).toHaveLength(0);
    });

    test("an arm whose condition cannot be resolved is still checked normally", () => {
      // FLAG is never defined, so the arm's fate is unknown and it is
      // treated as ordinary code, exactly as before this fix.
      expect(
        lintSource(source("FLAG"), { processors: ["mc68000"] }).filter(
          (d) => d.ruleId === RULE,
        ),
      ).toHaveLength(0);
    });
  });
});
