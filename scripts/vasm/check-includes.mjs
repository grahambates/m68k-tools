/**
 * Include search against vasm.
 *
 * vasm looks for an include in the directory it is run from, then in the
 * directory of the main source, then in the `-I` paths and `incdir`s, a
 * relative one being tried from each of the first two. It does not look beside
 * the file that names the include. The linter follows includes to read what
 * they define, and finding a file vasm would not is harmless, but failing to
 * find one vasm does is not, so this builds trees, has vasm assemble them, and
 * checks that every include vasm can open is one the linter's search reaches.
 *
 * Run from the repository root after `pnpm build`.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { findVasm } from "./vasm.mjs";

const vasm = findVasm();
if (!vasm) {
  console.log("vasm not found (set VASM): skipping the include check");
  process.exit(0);
}

const { followIncludes, nodeIncludeFs } = await import(
  new URL(
    "../../packages/m68k-lint/dist/cli/project-config.js",
    import.meta.url,
  )
);

// The model of vasm's search that the language server uses, which is TypeScript
// source, so it is bundled here.
const bundled = await build({
  entryPoints: [
    new URL("../../packages/assembly-options/src/index.ts", import.meta.url)
      .pathname,
  ],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { findVasmInclude, includeArguments } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

/** Whether the model says vasm opens every include in the tree under a main source. */
function modelOpens(mainPath, cwd, args) {
  const includePaths = includeArguments(args);
  const incDirs = [];
  const queue = [mainPath];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const text = readFileSync(queue[i], "utf8");
    for (const [, name] of text.matchAll(/^\s*incdir\s+"([^"]+)"/gim))
      incDirs.push(name);
    for (const [, name] of text.matchAll(/^\s*include\s+"([^"]+)"/gim)) {
      const found = findVasmInclude(
        name,
        { cwd, mainDir: dirname(mainPath), includePaths, incDirs },
        existsSync,
      );
      if (!found) return false;
      if (!seen.has(found)) {
        seen.add(found);
        queue.push(found);
      }
    }
  }
  return true;
}

const root = await mkdtemp(join(tmpdir(), "m68k-include-check-"));
const files = {
  "src/main.s": "",
  "src/c.i": "\tnop\n",
  "lib/a.i": '\tinclude "c.i"\n',
  "lib/b.i": "\tnop\n",
  "lib/a3.i": '\tinclude "b.i"\n',
  "lib/a2.i": '\tinclude "../lib/b.i"\n',
  "inc/e.i": "\tnop\n",
  "other/d.i": "\tnop\n",
};
for (const [path, text] of Object.entries(files)) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

// Each scenario: the main source's text, where vasm is run, its extra
// arguments, and the include paths (`-I`) the linter is given, which the
// config gives it as absolute directories.
const scenarios = [
  { name: "a path from the run directory", main: 'include "lib/b.i"', cwd: "" },
  {
    name: "beside the main source, run elsewhere",
    main: 'include "c.i"',
    cwd: "other",
  },
  {
    name: "nested, named from the main source's directory",
    main: 'include "../lib/a.i"',
    cwd: "",
  },
  {
    name: "nested, named beside the includer",
    main: 'include "../lib/a2.i"',
    cwd: "",
  },
  {
    name: "-I from the run directory",
    main: 'include "e.i"',
    cwd: "",
    args: ["-Iinc"],
  },
  {
    name: "-I relative to the main source's directory",
    main: 'include "e.i"',
    cwd: "",
    args: ["-I../inc"],
  },
  {
    name: "-I from a run directory elsewhere",
    main: 'include "e.i"',
    cwd: "other",
    args: ["-I../inc"],
  },
  { name: "incdir", main: 'incdir "../inc"\n\tinclude "e.i"', cwd: "" },
  {
    name: "incdir relative to the run directory",
    main: 'incdir "inc"\n\tinclude "e.i"',
    cwd: "",
  },
  {
    name: "a bare name that is only beside the includer",
    main: 'include "../lib/a3.i"',
    cwd: "",
  },
  { name: "not reachable at all", main: 'include "d.i"', cwd: "" },
  {
    name: "beside the includer only",
    main: 'include "../lib/a.i"',
    cwd: "",
    nestedBare: true,
  },
];

let unreached = 0;
let modelWrong = 0;
let lenient = 0;
for (const scenario of scenarios) {
  const main = `\t${scenario.main}\n`;
  await writeFile(join(root, "src/main.s"), main);
  const cwd = join(root, scenario.cwd);
  const ran = spawnSync(
    vasm,
    [
      "-quiet",
      "-Fbin",
      "-no-opt",
      ...(scenario.args ?? []),
      join(root, "src/main.s"),
      "-o",
      join(root, "out.bin"),
    ],
    { cwd, encoding: "utf8" },
  );
  const opened = !/(?:^|\n)(?:fatal )?error \d+/.test(ran.stdout + ran.stderr);

  // What the linter would be given: the run directory as the source root, and
  // the -I paths as written, which the search tries from both directories.
  const includePaths = includeArguments(scenario.args ?? []);
  const fs = nodeIncludeFs();
  const source = { path: join(root, "src/main.s"), source: main };
  const followed = await followIncludes([source], {
    sourceRoot: cwd,
    includePaths,
    fs,
  });
  const found = followed.length > 0;

  const predicted = modelOpens(
    join(root, "src/main.s"),
    cwd,
    scenario.args ?? [],
  );
  if (predicted !== opened) {
    modelWrong++;
    console.log(
      `  MODEL     ${scenario.name}: the model says ${predicted ? "opens" : "fails"}, vasm ${opened ? "opens it" : "fails"}`,
    );
  }

  const verdict =
    opened && !found ? "UNREACHED" : !opened && found ? "lenient" : "agree";
  if (verdict === "UNREACHED") unreached++;
  if (verdict === "lenient") lenient++;
  console.log(
    `  ${verdict.padEnd(9)} ${scenario.name}: vasm ${opened ? "opens it" : "cannot"}, linter ${found ? "finds it" : "does not"}`,
  );
}

await rm(root, { recursive: true, force: true });
console.log(
  `${scenarios.length} scenarios: ${unreached} include(s) vasm opens that the linter does not reach, ${lenient} the linter finds that vasm does not`,
);
console.log(
  `${modelWrong} scenario(s) where the search-order model disagrees with vasm`,
);
process.exitCode = unreached || modelWrong ? 1 : 0;
