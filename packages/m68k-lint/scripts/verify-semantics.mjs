#!/usr/bin/env node --experimental-wasm-modules
/**
 * Differential checker for rule replacements.
 *
 * The impact audit proves a replacement is cheaper. Nothing proved it was
 * equivalent: every rule's semantics rest on hand-reasoning recorded in
 * comments. This runs the original and the replacement on an interpreter and
 * compares the machine state afterwards.
 *
 * It is a bug finder, not a prover. The interpreter is a teaching tool whose
 * own documentation says not to expect complete accuracy, so a disagreement
 * means a rule and an interpreter disagree, and a human decides which is wrong.
 * That is why this is not part of `npm test` and does not gate CI.
 *
 * The interpreter leaks: it panics after roughly 250 instantiations and exposes
 * no way to dispose one. So the work is sharded across child processes, each
 * staying well under that ceiling.
 *
 * Run:  npm run verify:semantics
 */
import { S68k } from "@specy/s68k";
import { parseFile } from "m68k-parser";
import { CONFORMANCE } from "./conformance.mjs";

const OPTIONS = { keep_history: false, history_size: 0 };
/** getFlagsAsArray order, from the Flag enum. */
const FLAG_NAMES = ["C", "V", "Z", "N", "X"];
const LIMIT = 20000;
/** Seeded rounds per case. Kept low because each one costs two instantiations. */
const ROUNDS = 8;
/** Cases per child process, chosen to stay under the interpreter's leak ceiling. */
const SHARD_SIZE = 12;

/**
 * The interpreter's assembler differs from a real one in three places, so source
 * is normalised into what it accepts. None of the changes alters semantics.
 *
 * EOR with an immediate is EORI, and the bit and word-multiply instructions have
 * one operand size each, which it refuses to see written out.
 *
 * The third matters more. A real assembler silently selects the address form —
 * MOVEA, ADDA, SUBA, CMPA — whenever the destination is an address register, and
 * MOVEA, ADDA and SUBA set no condition codes at all. The interpreter instead
 * runs the data form and writes flags. Left alone it reports a flag difference
 * for every rule that touches SP or an address register, which is how
 * `prefer-link-sequence` twice appeared to be unsafe. Writing the address form
 * explicitly is what the assembler would have encoded anyway, and it also gets
 * the width right: MOVEA.W sign-extends into the full register where MOVE.W
 * would write only the low half.
 */
function adapt(line) {
  return line
    .replace(/^eor(\.[bwl])?(\s+#)/i, "eori$1$2")
    .replace(/^(muls|mulu|divs|divu|bset|bclr|btst|bchg)\.[bwl]\b/i, "$1")
    .replace(
      /^(add|sub|move|cmp)(\.[wl])?(\s+.*,\s*(?:a[0-7]|sp))$/i,
      "$1a$2$3",
    );
}

function assemble(lines) {
  // Replacements now carry the indentation of the code they replace, and the
  // adapt() patterns are anchored, so trim before matching and re-indent here.
  const body = lines
    .map((raw) => raw.trim())
    .map((l) => (/^\S+:/.test(l) ? l : `  ${adapt(l)}`))
    .join("\n");
  const source = `ORG $1000\n${body}\n`;
  const errors = S68k.semanticCheck(source);
  if (errors.length)
    return { error: errors.map((e) => e.getMessage()).join("; ") };
  return { source };
}

function execute(lines, seed) {
  const { source, error } = assemble(lines);
  if (error) return { error };
  let interpreter;
  try {
    interpreter = new S68k(source).createInterpreter(OPTIONS);
    for (const [register, value] of seed ?? []) {
      interpreter.setRegisterValue(register, value);
    }
    // Audit fixtures are fragments and mostly do not end in RTS, so running to
    // completion would fall off the end into unmapped memory. Step instead, and
    // stop at the last instruction.
    let steps = 0;
    while (!interpreter.hasReachedBottom() && steps++ < LIMIT)
      interpreter.step();
    if (steps >= LIMIT) return { error: "did not terminate" };
  } catch (e) {
    return {
      error: `execution failed: ${String(e).split("\n")[0].slice(0, 80)}`,
    };
  }
  const flags = interpreter.getFlagsAsArray();
  return {
    registers: interpreter
      .getCpuSnapshot()
      .getRegistersValues()
      .map((v) => v >>> 0),
    flags: FLAG_NAMES.filter((_, i) => flags[i]).join(""),
  };
}

const hex = (v) => `$${(v >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
const sortFlags = (f) => [...f].sort().join("");

/* ------------------------------------------------------------------ */
/* Phase 1: how far can the interpreter be trusted?                    */
/* ------------------------------------------------------------------ */

function calibrate() {
  const failures = [];
  for (const c of CONFORMANCE) {
    const result = execute(c.code);
    if (result.error) {
      failures.push({ name: c.name, detail: result.error });
      continue;
    }
    const actualFlags = sortFlags(result.flags);
    const wantFlags = sortFlags(c.flags);
    const d0 = result.registers[0];
    if (d0 !== c.d0 >>> 0) {
      failures.push({
        name: c.name,
        detail: `d0 ${hex(d0)}, documented ${hex(c.d0)}`,
      });
    } else if (actualFlags !== wantFlags) {
      failures.push({
        name: c.name,
        detail: `flags ${actualFlags || "none"}, documented ${wantFlags || "none"}`,
      });
    }
  }
  return failures;
}

/* ------------------------------------------------------------------ */
/* Phase 2: does each replacement behave like what it replaces?        */
/* ------------------------------------------------------------------ */

/** Deterministic values, chosen for the edges where sign and overflow bugs live. */
const SEEDS = [
  0x00000000, 0x00000001, 0xffffffff, 0x00007fff, 0x00008000, 0x0000ffff,
  0x7fffffff, 0x80000000, 0x12345678, 0x0000000f, 0x000000ff, 0xdeadbeef,
];

function seedFor(round) {
  const pick = (i) => SEEDS[(round * 7 + i * 3) % SEEDS.length];
  const seed = [];
  for (let d = 0; d < 8; d++) seed.push([{ type: "Data", value: d }, pick(d)]);
  // Address registers point into a safe scratch area rather than anywhere.
  for (let a = 0; a < 6; a++)
    seed.push([{ type: "Address", value: a }, 0x3000 + a * 0x40]);
  return seed;
}

function splice(lines, start, end, replacement) {
  // Replacements carry the indentation of the code they replace. The source
  // lines here are already trimmed, and several checks downstream are anchored
  // patterns, so normalise on the way in rather than at each use.
  const inserted =
    replacement === ""
      ? []
      : replacement.split("\n").map((line) => line.trim());
  return [...lines.slice(0, start), ...inserted, ...lines.slice(end + 1)];
}

/**
 * Register and flag differences are kept apart because applicability excuses
 * one and never the other. A rule that declares itself `conditional` has said
 * it changes the condition codes and fires only where they are dead, so a flag
 * difference is the rule working as documented. A register difference is a
 * different value in a program-visible place, which nothing declares away.
 */
function compare(before, after) {
  const registers = [];
  for (
    let i = 0;
    i < Math.max(before.registers.length, after.registers.length);
    i++
  ) {
    if (before.registers[i] !== after.registers[i]) {
      const name = i < 8 ? `d${i}` : `a${i - 8}`;
      registers.push(
        `${name} ${hex(before.registers[i])} vs ${hex(after.registers[i])}`,
      );
    }
  }
  const flags =
    sortFlags(before.flags) === sortFlags(after.flags)
      ? undefined
      : `flags ${before.flags || "none"} vs ${after.flags || "none"}`;
  return { registers, flags, any: registers.length > 0 || flags !== undefined };
}

export { adapt, assemble, execute, calibrate, splice, compare, seedFor, hex };

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

async function runShard(from, to) {
  const { ruleImpactAuditCases, normalizeRuleImpactAuditSource } =
    await import("../dist/audit/rule-impact.js");
  const { lintParsedFile } = await import("../dist/core/lint.js");
  const { defaultRules } = await import("../dist/rules/index.js");

  const byId = new Map(defaultRules.map((r) => [r.meta.id, r]));
  const report = {
    checked: 0,
    agreed: 0,
    disagreed: [],
    declared: [],
    skipped: new Map(),
  };
  const skip = (why, id) =>
    report.skipped.set(why, [...(report.skipped.get(why) ?? []), id]);

  for (const testCase of ruleImpactAuditCases.slice(from, to)) {
    const rule = byId.get(testCase.ruleId);
    if (!rule) continue;
    if (testCase.exempt) {
      skip("exempt from the impact audit", testCase.ruleId);
      continue;
    }

    const source = normalizeRuleImpactAuditSource(testCase.source);
    const lines = source
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const diagnostic = lintParsedFile(
      parseFile(source),
      source,
      { processors: [testCase.processor ?? "mc68000"], measureImpact: true },
      [rule],
    ).find((d) => d.ruleId === testCase.ruleId);

    const replacement = diagnostic?.suggestion?.replacement;
    if (replacement === undefined) {
      skip("rule offers no replacement text", testCase.ruleId);
      continue;
    }

    // The span is a property of the diagnostic now, not something measurement
    // leaves behind in `data`.
    const span = diagnostic.span;
    const start = span ? span.startLine - 1 : undefined;
    const end = span ? span.endLine - 1 : undefined;
    if (start === undefined || end === undefined) {
      skip("no source span", testCase.ruleId);
      continue;
    }

    const after = splice(lines, start, end, replacement);

    // A shorter replacement moves every label after it, so a fixture that loads
    // a label address reports a register difference that is purely an artifact
    // of the splice. Only cases whose size actually changed are affected.
    if (lines.some((l) => /^\S+:/.test(l)) && after.length !== lines.length) {
      skip(
        "fixture loads a label address that moves when the code shrinks",
        testCase.ruleId,
      );
      continue;
    }
    // s68k adjusts A7 by one on a byte push, where a 68000 adjusts by two to
    // keep the stack even. Anything pushing or popping a byte via SP lands on
    // that divergence, so its stack pointer cannot be compared. See
    // KNOWN_DIVERGENCES in conformance.mjs.
    if (
      [...lines, ...after].some((l) =>
        /^move\.b\s.*(-\(sp\)|\(sp\)\+)/i.test(l),
      )
    ) {
      skip(
        "byte push via SP, where the interpreter is known to diverge",
        testCase.ruleId,
      );
      continue;
    }

    const probe = execute(lines);
    if (probe.error) {
      skip(
        `interpreter cannot run the original (${probe.error.slice(0, 40)})`,
        testCase.ruleId,
      );
      continue;
    }
    const probeAfter = execute(after);
    if (probeAfter.error) {
      skip(
        `interpreter cannot run the replacement (${probeAfter.error.slice(0, 40)})`,
        testCase.ruleId,
      );
      continue;
    }

    report.checked++;
    let found = null;
    for (let round = 0; round < ROUNDS && !found; round++) {
      const seed = seedFor(round);
      const b = execute(lines, seed);
      const a = execute(after, seed);
      if (b.error || a.error) continue;
      const d = compare(b, a);
      if (d.any) found = { round, ...d };
    }

    const applicability = diagnostic.suggestion?.applicability;
    if (!found) {
      report.agreed++;
    } else if (found.registers.length === 0 && applicability !== "safe") {
      // Flags only, from a rule that declares it changes them. Documented, not wrong.
      report.declared.push({
        id: testCase.ruleId,
        caseId: testCase.caseId,
        applicability,
        ...found,
      });
    } else {
      report.disagreed.push({
        id: testCase.ruleId,
        caseId: testCase.caseId,
        replacement,
        applicability,
        ...found,
      });
    }
  }

  return {
    checked: report.checked,
    agreed: report.agreed,
    disagreed: report.disagreed,
    declared: report.declared,
    skipped: [...report.skipped].map(([why, ids]) => [why, ids.length]),
  };
}

async function main() {
  const shardArg = process.argv.find((a) => a.startsWith("--shard="));
  const { ruleImpactAuditCases } = await import("../dist/audit/rule-impact.js");

  if (shardArg) {
    // Children speak JSON on stdout and nothing else, so calibration, which
    // would cost each of them 26 more interpreters, is left to the parent.
    const [from, to] = shardArg.slice(8).split(":").map(Number);
    process.stdout.write(JSON.stringify(await runShard(from, to)));
    return 0;
  }

  const failures = calibrate();
  console.log(
    `Calibration: ${CONFORMANCE.length - failures.length}/${CONFORMANCE.length} documented behaviours agree.`,
  );
  for (const f of failures) console.log(`  diverges: ${f.name} — ${f.detail}`);
  if (failures.length) {
    console.log(
      "\nThe interpreter disagrees with the reference above, so results below are\nunreliable in those areas. Fix the calibration before reading further.",
    );
  }
  console.log("");

  // Fan the cases out so no child exceeds the interpreter's ceiling.
  const { execFileSync } = await import("node:child_process");
  const total = {
    checked: 0,
    agreed: 0,
    disagreed: [],
    declared: [],
    skipped: new Map(),
  };
  for (let from = 0; from < ruleImpactAuditCases.length; from += SHARD_SIZE) {
    const to = Math.min(from + SHARD_SIZE, ruleImpactAuditCases.length);
    const out = execFileSync(
      process.execPath,
      ["--experimental-wasm-modules", process.argv[1], `--shard=${from}:${to}`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 1 << 24,
      },
    );
    const shard = JSON.parse(out);
    total.checked += shard.checked;
    total.agreed += shard.agreed;
    total.disagreed.push(...shard.disagreed);
    total.declared.push(...shard.declared);
    for (const [why, n] of shard.skipped)
      total.skipped.set(why, (total.skipped.get(why) ?? 0) + n);
  }

  console.log(
    `Checked ${total.checked} replacements against their originals, ${ROUNDS} seeded states each.`,
  );
  console.log(`  identical everywhere:        ${total.agreed}`);
  console.log(`  differ only in declared flags: ${total.declared.length}`);
  console.log(`  unexplained differences:     ${total.disagreed.length}`);
  for (const [why, n] of [...total.skipped].sort((a, b) => b[1] - a[1])) {
    console.log(`  skipped, ${why}: ${n}`);
  }

  if (total.declared.length) {
    console.log(
      "\nDeclared. These rules say they change the condition codes and fire only",
    );
    console.log(
      "where the codes are dead, so a flag difference is the rule working as",
    );
    console.log("documented. Registers match.\n");
    for (const f of total.declared) {
      console.log(
        `  ${f.id}${f.caseId ? ` [${f.caseId}]` : ""} (${f.applicability}): ${f.flags}`,
      );
    }
  }

  if (total.disagreed.length) {
    console.log(
      "\nUnexplained. Either a register differs, which no applicability excuses,",
    );
    console.log(
      "or a rule claiming `safe` changed a flag. A human decides whether the rule",
    );
    console.log("or the interpreter is wrong.\n");
    for (const f of total.disagreed) {
      console.log(
        `  ${f.id}${f.caseId ? ` [${f.caseId}]` : ""}  (${f.applicability})`,
      );
      console.log(`      replacement: ${JSON.stringify(f.replacement)}`);
      console.log(
        `      differs at:  ${[...f.registers, f.flags].filter(Boolean).join(", ")}`,
      );
    }
  }
  return 0;
}

if (process.argv[1]?.endsWith("verify-semantics.mjs")) {
  main().then((code) => {
    process.exitCode = code;
  });
}
