/**
 * Lint suggestions against vasm.
 *
 * Each optimisation rule has a representative case for the impact audit. This
 * applies the rule's own suggestion to it and assembles the source before and
 * after, without optimisation so that what is assembled is what is written and
 * not something vasm has already improved. Three things are checked:
 *
 * - the replacement assembles at all, and does so without a warning the
 *   original did not give;
 * - the change in size is the one 68kcounter measured, since that is the
 *   figure the linter reports;
 * - the replacement is not accepted by vasm only because it optimised it.
 *
 * Cases the assembler cannot take on their own, for example because they name a
 * symbol nothing defines, are listed and skipped.
 *
 * Run from the repository root after `pnpm build`.
 */
import { createRequire } from "node:module";
import { loadCorpus } from "./corpus.mjs";
import { assemble, findVasm, inParallel, cleanUp } from "./vasm.mjs";

const require = createRequire(import.meta.url);
const lint = require("../../packages/m68k-lint");

const vasm = findVasm();
if (!vasm) {
  console.log("vasm not found (set VASM): skipping the suggestion check");
  process.exit(0);
}

const cpuArg = (processor) =>
  processor && processor !== "mc68000"
    ? [`-m${processor.replace(/^mc/, "")}`]
    : [];
const warnings = (messages) =>
  messages
    .split("\n")
    .filter((line) => /^(warning|message) \d+/.test(line))
    .map((line) => line.replace(/ in line \d+ of "[^"]*"/, ""));

// The size the impact audit measured, per rule and case.
const measured = new Map(
  lint.runRuleImpactAudit().map((r) => [`${r.ruleId}|${r.detail ?? ""}`, r]),
);

const problems = [];
const skipped = [];
let checked = 0;

for (const auditCase of lint.ruleImpactAuditCases) {
  if (auditCase.exempt && !auditCase.source) continue;
  const id = auditCase.ruleId;
  const key = `${id}|${auditCase.caseId ?? ""}`;
  const source = lint.normalizeRuleImpactAuditSource(auditCase.source ?? "");
  if (!source) continue;

  const config = {
    processors: [auditCase.processor ?? "mc68000"],
    goal: "balanced",
    measureImpact: true,
    rules: { [id]: "warning" },
  };
  const found = lint
    .lintSource(source, config)
    .find((d) => d.ruleId === id && d.suggestion?.replacement !== undefined);
  if (!found) continue;

  // The representative case can carry alternatives now (a cheaper conditional
  // form alongside a safe default, say). applyOnce refuses to pick between
  // them unattended, same as it would for a person running --fix, but that
  // policy is not what this loop is checking: it wants this rule's own
  // suggestion applied and assembled, so it applies that directly.
  const { output: after } = lint.applyOnce(
    source,
    [{ ...found, alternatives: undefined }],
    ["safe", "conditional", "manual"],
    "none",
    ["improvement", "tradeoff", "neutral", "regression"],
  );
  const args = cpuArg(auditCase.processor);
  const before = await assemble(vasm, source + "\n", { args });
  const changed = await assemble(vasm, after + "\n", { args });

  const label = `${id}${auditCase.caseId ? ` (${auditCase.caseId})` : ""}`;
  if (!before.bytes) {
    skipped.push(
      `${label}: the original does not assemble: ${before.messages.trim().split("\n")[0]}`,
    );
    continue;
  }
  checked++;
  if (!changed.bytes) {
    problems.push(
      `${label}: the replacement does not assemble\n    ${after.replace(/\n/g, "\n    ")}\n    ${changed.messages.trim().split("\n")[0]}`,
    );
    continue;
  }
  const newWarnings = warnings(changed.messages).filter(
    (w) => !warnings(before.messages).includes(w),
  );
  if (newWarnings.length)
    problems.push(
      `${label}: the replacement makes vasm warn: ${newWarnings[0]}\n    ${after.replace(/\n/g, "\n    ")}`,
    );

  const claimed = measured.get(key)?.sizeDelta;
  const actual = changed.bytes.length - before.bytes.length;
  if (process.argv.includes("--verbose"))
    console.log(
      `  ${label}: ${before.bytes.length} -> ${changed.bytes.length} (${actual >= 0 ? "+" : ""}${actual}), reported ${claimed}`,
    );
  if (claimed !== undefined && claimed !== actual)
    problems.push(
      `${label}: reports ${claimed} bytes, vasm says ${actual}\n    ${source.replace(/\n/g, "\n    ")}\n    =>\n    ${after.replace(/\n/g, "\n    ")}`,
    );
}

// A far larger set: every instruction 68kcounter is tested with, and a generated
// spread of immediates, sizes and destinations, each on its own and linted with
// every optimisation rule on. Each suggestion is applied by itself.
const corpus = await loadCorpus();
const all = Object.fromEntries(
  lint.defaultRules
    .filter((rule) => rule.meta.category === "optimization")
    .map((rule) => [rule.meta.id, "warning"]),
);

const generated = [];
{
  const values = [
    "0",
    "1",
    "2",
    "7",
    "8",
    "9",
    "-1",
    "-8",
    "-9",
    "127",
    "128",
    "-128",
    "255",
    "256",
    "$7fff",
    "$8000",
    "$ffff",
    "$10000",
    "$ffffff80",
    "$ffffffff",
    "1234",
  ];
  const destinations = [
    "d0",
    "a0",
    "(a0)",
    "(a0)+",
    "-(sp)",
    "4(a0)",
    "0(a0)",
    "(a0,d1.w)",
    "(xxx).w",
    "(xxx).l",
    "d3",
  ];
  const twoOperand = [
    "move",
    "add",
    "sub",
    "cmp",
    "and",
    "or",
    "eor",
    "adda",
    "suba",
    "cmpa",
    "movea",
    "addi",
    "subi",
    "cmpi",
    "andi",
    "ori",
    "eori",
    "muls",
    "mulu",
    "divs",
    "divu",
    "lsl",
    "lsr",
    "asl",
    "asr",
    "rol",
    "ror",
    "btst",
    "bset",
    "bclr",
    "bchg",
    "link",
  ];
  for (const op of twoOperand)
    for (const size of ["", ".b", ".w", ".l"])
      for (const value of values)
        for (const destination of destinations)
          generated.push(`\t${op}${size}\t#${value},${destination}`);
  for (const size of [".b", ".w", ".l"])
    for (const destination of destinations)
      generated.push(
        `\tclr${size}\t${destination}`,
        `\ttst${size}\t${destination}`,
      );
  for (const register of ["a0", "a1", "sp"])
    generated.push(
      `\tlea\t0(${register}),${register}`,
      `\tlea\t(${register}),${register}`,
      `\tlea\t4(${register}),${register}`,
      `\tlea\t(xxx).w,${register}`,
      `\tlea\t(xxx).l,${register}`,
      `\tpea\t(xxx).l`,
      `\tmove.l\t#xxx,-(sp)`,
      `\tmove.l\t${register},-(sp)`,
    );
}
const candidates = [
  ...corpus.instructions.map((c) => ({ ...c, source: corpus.source(c.text) })),
  ...generated.map((text, i) => ({
    text,
    line: `g${i}`,
    source: corpus.source(text),
  })),
];
const broad = await inParallel(candidates, async (c) => {
  const source = c.source;
  const found = lint
    .lintSource(source, {
      processors: ["mc68000"],
      goal: "balanced",
      measureImpact: true,
      rules: all,
    })
    .filter(
      (d) =>
        d.ruleId.startsWith("optimization/") &&
        d.suggestion?.replacement !== undefined &&
        d.span,
    );
  if (!found.length) return [];
  const before = await assemble(vasm, source);
  if (!before.bytes) return [];
  const out = [];
  for (const d of found) {
    const { output } = lint.applyOnce(
      source,
      [d],
      ["safe", "conditional", "manual"],
      "none",
      ["improvement", "tradeoff", "neutral", "regression"],
    );
    if (output === source) continue;
    out.push({ c, d, before, changed: await assemble(vasm, output) });
  }
  return out;
});
let broadChecked = 0;
for (const { c, d, before, changed } of broad.flat()) {
  broadChecked++;
  const what = `line ${c.line} ${c.text.trim().split(/\s{2,}/)[0]} -> ${d.ruleId}`;
  const replacement = d.suggestion.replacement.replace(/\n/g, "\n    ");
  if (!changed.bytes) {
    problems.push(
      `${what}: the replacement does not assemble\n    ${replacement}\n    ${changed.messages.trim().split("\n")[0]}`,
    );
    continue;
  }
  const claimed = d.suggestion.impact?.sizeBytes?.delta;
  const actual = changed.bytes.length - before.bytes.length;
  if (claimed !== undefined && claimed !== actual)
    problems.push(
      `${what}: reports ${claimed} bytes, vasm says ${actual}\n    ${replacement}`,
    );
  const newWarnings = warnings(changed.messages).filter(
    (w) => !warnings(before.messages).includes(w),
  );
  if (newWarnings.length)
    problems.push(
      `${what}: the replacement makes vasm warn: ${newWarnings[0]}\n    ${replacement}`,
    );
}

console.log(
  `${checked} representative cases and ${broadChecked} suggestions on ${candidates.length} generated and corpus lines checked, ${problems.length} problems, ${skipped.length} skipped`,
);
for (const p of problems.slice(0, 60)) console.log(`  ${p}`);
if (problems.length > 60) console.log(`  ... and ${problems.length - 60} more`);
if (process.argv.includes("--skipped"))
  for (const s of skipped) console.log(`  skipped ${s}`);

await cleanUp();
process.exitCode = problems.length ? 1 : 0;
