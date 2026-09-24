import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Publish each extension whose version is not already on the Marketplace.
// Changesets only bumps an extension when a changeset names it, so a release
// usually leaves some unchanged; publishing those fails, and must not stop the
// others from going out.

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const extensions = [
  // The counter is published under a different name from its package.
  { app: "m68k-lsp", script: "publish:assembly" },
  { app: "m68k-lint-vscode", script: "publish:lint" },
  { app: "68kcounter-vscode", script: "publish:counter", name: "68kcounter" },
];

const failed = [];
for (const { app, script, name } of extensions) {
  const source = join(root, "apps", app);
  const manifest = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );
  const id = `${manifest.publisher}.${name ?? manifest.name}`;

  let published;
  try {
    const shown = execFileSync(
      join(source, "node_modules/.bin/vsce"),
      ["show", id, "--json"],
      { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    published = JSON.parse(shown).versions?.[0]?.version;
  } catch {
    // Not found, or the Marketplace could not be asked: let the publish decide.
  }

  if (published === manifest.version) {
    console.log(`${id} ${manifest.version} is already published, skipping`);
    continue;
  }
  console.log(
    `Publishing ${id} ${manifest.version} (Marketplace has ${published ?? "unknown"})`,
  );
  try {
    execFileSync("pnpm", ["run", script], { cwd: root, stdio: "inherit" });
  } catch {
    failed.push(id);
  }
}

if (failed.length) {
  console.error(`Failed to publish: ${failed.join(", ")}`);
  process.exit(1);
}
