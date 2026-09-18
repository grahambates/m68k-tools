import { copySourceMap } from "./copy-source-map.mjs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));

const shared = {
  bundle: true,
  platform: "node",
  // The VS Code extension host loads CommonJS, and a CJS bundle doubles as the
  // npm `bin` for editors that launch the server directly.
  format: "cjs",
  target: "node20",
  minify: args.has("--minify"),
  sourcemap: args.has("--sourcemap"),
  logLevel: "info",
};

const serverOut = join(root, "packages/m68k-lint-langserver/out/server.js");
const clientOut = join(root, "apps/m68k-lint-vscode/out/extension.js");
const bundledServer = join(root, "apps/m68k-lint-vscode/out/server.js");
const schemaSrc = join(root, "packages/m68k-lint/m68k-lint.schema.json");
const bundledSchema = join(
  root,
  "apps/m68k-lint-vscode/out/m68k-lint.schema.json",
);

/** The .vsix ships the server next to the client, so the extension is self-contained. */
async function copyServer() {
  await mkdir(dirname(bundledServer), { recursive: true });
  await copyFile(serverOut, bundledServer);
  // Referenced by the extension's jsonValidation, so config files validate
  // offline against the schema that matches the bundled linter.
  await copyFile(schemaSrc, bundledSchema);
  if (args.has("--sourcemap")) await copySourceMap(serverOut, bundledServer);
}

/**
 * Copies on every successful build, not just once after the initial one.
 * In watch mode the extension would otherwise keep launching the server
 * bundle as it stood when watch started.
 */
const copyServerPlugin = {
  name: "copy-server",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      await copyServer();
    });
  },
};

const server = {
  ...shared,
  entryPoints: [join(root, "packages/m68k-lint-langserver/src/server.ts")],
  outfile: serverOut,
  banner: { js: "#!/usr/bin/env node" },
  plugins: [copyServerPlugin],
};

const client = {
  ...shared,
  entryPoints: [join(root, "apps/m68k-lint-vscode/src/extension.ts")],
  outfile: clientOut,
  // Supplied by the extension host, never bundled.
  external: ["vscode"],
};

// A minified build leaves the previous run's .map behind, which is stale the
// moment it is orphaned. Clear both out directories rather than layer builds.
await Promise.all(
  [
    join(root, "packages/m68k-lint-langserver/out"),
    join(root, "apps/m68k-lint-vscode/out"),
  ].map((dir) => rm(dir, { recursive: true, force: true })),
);

if (args.has("--watch")) {
  const contexts = await Promise.all([
    esbuild.context(server),
    esbuild.context(client),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("watching");
} else {
  await Promise.all([esbuild.build(server), esbuild.build(client)]);
  console.log("built");
}
