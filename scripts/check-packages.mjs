import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "m68k-tools-pack-"));
const names = [
  "m68k-parser",
  "68kcounter",
  "m68k-lint",
  "m68k-formatter",
  "m68k-lsp-server",
  "m68k-lint-langserver",
];
const dependencies = {};
for (const name of names) {
  const archive = join(temp, name + ".tgz");
  execFileSync(
    "pnpm",
    ["--dir", join(root, "packages", name), "pack", "--out", archive],
    { stdio: "inherit" },
  );
  dependencies[name] = "file:" + archive;
}
writeFileSync(
  join(temp, "package.json"),
  JSON.stringify({ private: true, dependencies }, null, 2),
);
writeFileSync(
  join(temp, "pnpm-workspace.yaml"),
  JSON.stringify({ overrides: dependencies }),
);
execFileSync("pnpm", ["install", "--ignore-scripts"], {
  cwd: temp,
  stdio: "inherit",
});
copyFileSync(
  join(root, "scripts/fixtures/packages/smoke.cjs"),
  join(temp, "smoke.cjs"),
);
execFileSync(process.execPath, ["smoke.cjs"], { cwd: temp, stdio: "inherit" });
// Check both conditional declaration branches from an isolated consumer too.
copyFileSync(
  join(root, "scripts/fixtures/packages/consumer.mts"),
  join(temp, "consumer.mts"),
);
copyFileSync(
  join(root, "scripts/fixtures/packages/consumer.cts"),
  join(temp, "consumer.cts"),
);
execFileSync(
  process.execPath,
  [
    join(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--types",
    "node",
    "--typeRoots",
    join(root, "node_modules/@types"),
    "consumer.mts",
    "consumer.cts",
  ],
  { cwd: temp, stdio: "inherit" },
);
console.log("ESM and CommonJS consumer declaration checks passed");
console.log(`Packed artifacts and isolated consumer retained in ${temp}`);
