import { execFileSync } from "node:child_process";
const mode = process.argv[2];
const run = (...args) => execFileSync("pnpm", args, { stdio: "inherit" });
const pkg = (name, script) => run("--filter", name, "run", script);
if (mode === "build") {
  for (const name of ["m68k-parser", "68kcounter", "m68k-lint"])
    pkg(name, "build");
  run("run", "build:assembly");
  pkg("m68k-lint-langserver", "build");
  pkg("68kcounter-vscode", "compile");
  pkg("68kcounter-web", "build");
} else if (mode === "test") {
  run("run", "test:assembly");
  for (const name of [
    "m68k-parser",
    "68kcounter",
    "m68k-lint",
    "68kcounter-web",
  ])
    pkg(name, "test");
  pkg("m68k-lint-langserver", "test");
} else if (mode === "typecheck") {
  run("exec", "tsc", "-b", "packages/m68k-lsp-server", "apps/m68k-lsp");
  run("exec", "tsc", "-p", "packages/m68k-lsp-server/tsconfig.test.json");
  for (const name of ["m68k-lint", "m68k-lint-langserver", "68kcounter-web"])
    pkg(name, "typecheck");
  run("exec", "tsc", "-p", "packages/68kcounter/tsconfig.json", "--noEmit");
  for (const name of ["m68k-parser", "m68k-formatter"])
    run("exec", "tsc", "-p", `packages/${name}/tsconfig.test.json`);
  pkg("68kcounter-vscode", "compile");
} else if (mode === "lint") {
  run("exec", "eslint", ".");
} else {
  throw new Error(`Unknown workspace task: ${mode}`);
}
