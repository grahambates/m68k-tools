import { runInteractive, type Decision } from "../core/interactive.js";
import { lintSource } from "../core/lint.js";

/**
 * Reviewing findings one at a time. The answers are scripted here rather than
 * typed, which is the point of driving the session through a callback: the
 * ordering rules below are the fiddly part and want testing without a terminal.
 *
 * Questions come in file order, because that is how a person reads. Edits are
 * made afterwards from the bottom up, because that is the only order in which
 * line numbers stay valid.
 */
const SOURCE = [
  "start:",
  "\tmove.l\t#100,d0\t; count",
  "\tmove.l\t#5,d1",
  "\tmove.w\td4,d7",
  "\tmove.l\td7,(a0)",
  "\trts",
].join("\n");

const review = async (source: string, answers: Decision[]) => {
  const diagnostics = lintSource(source, { processors: ["mc68000"] });
  let i = 0;
  const asked: string[] = [];
  const result = await runInteractive(source, diagnostics, (diagnostic) => {
    asked.push(`${diagnostic.ruleId}@${diagnostic.span?.startLine}`);
    return Promise.resolve(answers[i++] ?? "skip");
  });
  return { ...result, asked };
};

describe("reviewing findings one at a time", () => {
  test("asks in file order", async () => {
    const { asked } = await review(SOURCE, []);
    expect(asked).toEqual([
      "optimization/prefer-moveq@2",
      "optimization/prefer-moveq@3",
      "suspicious/partial-register-write@4",
    ]);
  });

  test("skipping everything leaves the file alone", async () => {
    const { output, applied, suppressed } = await review(SOURCE, [
      "skip",
      "skip",
      "skip",
    ]);
    expect(output).toBe(SOURCE);
    expect(applied).toEqual([]);
    expect(suppressed).toEqual([]);
  });

  test("applying rewrites just that finding", async () => {
    const { output, applied } = await review(SOURCE, ["apply", "skip", "skip"]);
    expect(output.split("\n")[1]).toBe("\tmoveq\t#100,d0\t; count");
    expect(output.split("\n")[2]).toBe("\tmove.l\t#5,d1");
    expect(applied).toHaveLength(1);
  });

  test("several decisions at once land in the right places", async () => {
    const { output, applied, suppressed } = await review(SOURCE, [
      "apply",
      "allow",
      "allow",
    ]);
    expect(output.split("\n")).toEqual([
      "start:",
      "\tmoveq\t#100,d0\t; count",
      "\t; m68k-lint-disable-next-line optimization/prefer-moveq -- allowed here",
      "\tmove.l\t#5,d1",
      "\t; m68k-lint-disable-next-line suspicious/partial-register-write -- allowed here",
      "\tmove.w\td4,d7",
      "\tmove.l\td7,(a0)",
      "\trts",
    ]);
    expect(applied).toHaveLength(1);
    expect(suppressed).toHaveLength(2);
  });

  // The whole point of a suppression comment is that it silences the finding.
  test("what it writes actually suppresses on the next run", async () => {
    const { output } = await review(SOURCE, ["skip", "allow", "allow"]);
    const remaining = lintSource(output, { processors: ["mc68000"] }).map(
      (d) => d.ruleId,
    );
    expect(remaining).toEqual(["optimization/prefer-moveq"]);
  });

  // Silencing one occurrence and turning the rule off differ in scope, which is
  // the only distinction worth encoding: one writes a directive beside the
  // code, the other is reported back for the config.
  test("disabling a rule asks nothing further about it", async () => {
    const { output, disabledRules, asked } = await review(SOURCE, [
      "disable",
      "allow",
    ]);
    expect(disabledRules).toEqual(["optimization/prefer-moveq"]);
    // The second PREFER-MOVEQ finding is never put to the reader.
    expect(asked).toEqual([
      "optimization/prefer-moveq@2",
      "suspicious/partial-register-write@4",
    ]);
    // And nothing is written into the file for it.
    expect(output).not.toContain("disable-next-line optimization/prefer-moveq");
    expect(output).toContain(
      "disable-next-line suspicious/partial-register-write",
    );
  });

  test("quitting keeps the decisions already made", async () => {
    const { output, applied, quit } = await review(SOURCE, ["apply", "quit"]);
    expect(quit).toBe(true);
    expect(applied).toHaveLength(1);
    expect(output.split("\n")[1]).toBe("\tmoveq\t#100,d0\t; count");
    // The finding after the one quit on is untouched.
    expect(output.split("\n")[2]).toBe("\tmove.l\t#5,d1");
  });

  test("a finding with no rewrite can still be allowed", async () => {
    const source = "\tmove.w\td4,d7\n\tmove.l\td7,(a0)\n\trts";
    const { output, suppressed } = await review(source, ["allow"]);
    expect(suppressed).toHaveLength(1);
    expect(output.split("\n")[0]).toContain(
      "m68k-lint-disable-next-line suspicious/partial-register-write",
    );
  });

  test("a directive is indented to match the code it guards", async () => {
    const { output } = await review("        move.l  #100,d0\n        rts", [
      "allow",
    ]);
    expect(output.split("\n")[0]).toBe(
      "        ; m68k-lint-disable-next-line optimization/prefer-moveq -- allowed here",
    );
  });
});

/**
 * Answering forty identical findings one at a time is how a review stops being
 * read. `Y` settles a rule for the rest of the session, and is the counterpart
 * to `d`: one says always, the other never.
 */
describe("accepting a whole rule at once", () => {
  const MANY = [
    "start:",
    "\tmove.l\t#100,d0",
    "\tmove.l\t#5,d1",
    "\tmove.l\t#7,d2",
    "\tmove.w\td4,d7",
    "\tmove.l\td7,(a0)",
    "\trts",
  ].join("\n");

  test("asks once and applies the rest", async () => {
    const { output, applied, asked } = await review(MANY, ["apply-rule"]);
    expect(asked).toEqual([
      "optimization/prefer-moveq@2",
      "suspicious/partial-register-write@5",
    ]);
    expect(applied).toHaveLength(3);
    expect(output.split("\n").slice(1, 4)).toEqual([
      "\tmoveq\t#100,d0",
      "\tmoveq\t#5,d1",
      "\tmoveq\t#7,d2",
    ]);
  });

  test("other rules are still put to the reader", async () => {
    const { asked } = await review(MANY, ["apply-rule", "skip"]);
    expect(asked).toContain("suspicious/partial-register-write@5");
  });

  // The standing answer is "apply", so it cannot reach a finding of that rule
  // with nothing to apply.
  test("a finding of the same rule with no rewrite is still asked about", async () => {
    const source = [
      "\tmove.l\ta6,-(sp)",
      "\tmove.l\tsp,a6",
      "\tadd.w\t#-32,sp",
      "\tmoveq\t#0,d0",
      "\tmove.l\ta6,-(sp)",
      ".ret:\tmove.l\tsp,a6",
      "\tadd.w\t#-16,sp",
      "\tmoveq\t#0,d1",
      "\trts",
    ].join("\n");
    const { asked, applied } = await review(source, ["apply-rule"]);
    const link = asked.filter((a) =>
      a.startsWith("optimization/prefer-link-sequence"),
    );
    expect(link).toHaveLength(2);
    expect(applied).toHaveLength(1);
  });
});

/**
 * Two things vary: whether an answer covers one finding or the whole rule, and
 * whether it lasts for this run or is written down.
 *
 *     this run      y / n          Y / N
 *     written down  a (comment)    d (config entry)
 *
 * `Y` and `N` leave nothing behind; the next run asks again. That is what makes
 * them different from `d`, which is a config entry and permanent.
 */
describe("setting a rule aside for this run only", () => {
  const MANY = [
    "start:",
    "\tmove.l\t#100,d0",
    "\tmove.l\t#5,d1",
    "\tmove.w\td4,d7",
    "\tmove.l\td7,(a0)",
    "\trts",
  ].join("\n");

  test("stops asking without changing anything", async () => {
    const { output, applied, suppressed, disabledRules, asked } = await review(
      MANY,
      ["skip-rule"],
    );
    expect(asked).toEqual([
      "optimization/prefer-moveq@2",
      "suspicious/partial-register-write@4",
    ]);
    expect(output).toBe(MANY);
    expect(applied).toEqual([]);
    expect(suppressed).toEqual([]);
    // Nothing to write to the config: this was for now, not for good.
    expect(disabledRules).toEqual([]);
  });

  test("disabling the same rule instead is reported for the config", async () => {
    const { output, disabledRules } = await review(MANY, ["disable"]);
    expect(disabledRules).toEqual(["optimization/prefer-moveq"]);
    expect(output).toBe(MANY);
  });

  test("other rules are still asked about", async () => {
    const { asked } = await review(MANY, ["skip-rule", "allow"]);
    expect(asked).toContain("suspicious/partial-register-write@4");
  });
});
