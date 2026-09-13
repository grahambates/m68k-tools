const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
assert.equal(typeof require("m68k-parser").parseFile, "function");
assert.equal(typeof require("68kcounter").default, "function");
assert.equal(require("m68k-formatter").format(" NOP"), "        nop\n");
(async () => {
  assert.equal(typeof (await import("m68k-parser")).parseFile, "function");
  const esmCounter = await import("68kcounter");
  const cjsCounter = require("68kcounter");
  assert.equal(typeof esmCounter.default, "function");
  for (const source of [
    "  nop",
    "  lsl.l #3,d0",
    "  ds.b 8",
    "  rept 3\n  nop\n  endr",
    "N equ 4\n  ds.w N",
  ]) {
    const esmLines = esmCounter.default(source);
    const cjsLines = cjsCounter.default(source);
    // Each format has its own AST class constructors; compare their data.
    assert.deepEqual(
      JSON.parse(JSON.stringify(esmLines)),
      JSON.parse(JSON.stringify(cjsLines)),
    );
    assert.deepEqual(
      esmCounter.calculateTotals(esmLines),
      cjsCounter.calculateTotals(cjsLines),
    );
  }
  assert.equal(
    esmCounter.calculateTotals(esmCounter.default("  lsl.l #3,d0")).isRange,
    false,
  );
  assert.equal(typeof esmCounter.calculateTotals, "function");
  const esmFormatter = await import("m68k-formatter");
  assert.equal(
    esmFormatter.format(" NOP"),
    require("m68k-formatter").format(" NOP"),
  );
  assert.equal(
    typeof require("68kcounter/dist/parse/index.js").default,
    "function",
  );
  assert.equal(
    require("68kcounter/dist/parse"),
    require("68kcounter/dist/parse/index"),
  );
  assert.equal(
    require("68kcounter/dist/syntax"),
    require("68kcounter/dist/syntax.js"),
  );
  assert.equal(
    require("m68k-formatter/out/index").format(" NOP"),
    esmFormatter.format(" NOP"),
  );
  await import("m68k-lint");
  await import("m68k-lint/project-config");
  const path = require("node:path");
  for (const name of Object.keys(require("./package.json").dependencies)) {
    const fs = require("node:fs");
    const base = path.join(process.cwd(), "node_modules", name);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(base, "package.json"), "utf8"),
    );
    for (const bin of Object.values(manifest.bin || {}))
      assert.ok(fs.existsSync(path.join(base, bin)), name + " CLI missing");
  }
  execFileSync(process.execPath, ["node_modules/m68k-parser/cli.js", "-"], {
    input: " nop",
    stdio: ["pipe", "ignore", "inherit"],
  });
  execFileSync(
    process.execPath,
    ["node_modules/68kcounter/dist/cli.js", "--help"],
    { stdio: "ignore" },
  );
  execFileSync(
    process.execPath,
    ["node_modules/m68k-lint/dist/cli/main.js", "--help"],
    { stdio: "ignore" },
  );
  console.log("Isolated package imports and CLI smoke tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
