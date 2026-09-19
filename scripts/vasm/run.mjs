/**
 * Runs the checks that compare our tools with the real vasm.
 *
 * Optional: they need a vasm binary (set `VASM`, or have `vasmm68k_mot` on the
 * PATH) and skip themselves without one. They read the built output of the
 * packages, so build first.
 */
import { spawnSync } from "node:child_process";
import { findVasm } from "./vasm.mjs";

if (!findVasm()) {
  console.log("vasm not found (set VASM to a vasmm68k_mot binary): skipping");
  process.exit(0);
}

let failed = false;
for (const check of [
  "check-sizes",
  "check-suggestions",
  "check-syntax",
  "check-includes",
]) {
  console.log(`\n== ${check}`);
  const result = spawnSync(
    process.execPath,
    [
      new URL(`./${check}.mjs`, import.meta.url).pathname,
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
