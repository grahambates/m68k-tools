import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "apps/68kcounter-vscode");
const staging = join(root, ".staging/68kcounter-vscode");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
const manifest = JSON.parse(
  await readFile(join(source, "package.json"), "utf8"),
);
manifest.name = "68kcounter";
manifest.files = [
  "out/**",
  "images/**",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
];
delete manifest.scripts;
delete manifest.dependencies;
delete manifest.devDependencies;
await writeFile(
  join(staging, "package.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
for (const file of ["README.md", "CHANGELOG.md", "LICENSE", "images"]) {
  await cp(join(source, file), join(staging, file), { recursive: true });
}
await build({
  entryPoints: [join(source, "src/extension.ts")],
  outfile: join(staging, "out/extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2015",
  external: ["vscode"],
  sourcemap: process.argv.includes("--sourcemap"),
});
if (manifest.publisher !== "gigabates" || manifest.name !== "68kcounter") {
  throw new Error("Unexpected Marketplace identity");
}
if (!process.argv.includes("--stage-only")) {
  const vsixPath = join(root, `68kcounter-${manifest.version}.vsix`);
  execFileSync(
    join(source, "node_modules/.bin/vsce"),
    ["package", "--no-dependencies", "--out", vsixPath],
    { cwd: staging, stdio: "inherit" },
  );
  if (process.argv.includes("--publish")) {
    execFileSync(
      join(source, "node_modules/.bin/vsce"),
      ["publish", "--packagePath", vsixPath],
      { stdio: "inherit" },
    );
  }
}
