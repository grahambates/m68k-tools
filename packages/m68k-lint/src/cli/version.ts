import { readFileSync } from "node:fs";

/**
 * The package version, read from the manifest rather than repeated here.
 *
 * A hardcoded copy sat at 0.46.2 from the initial import through the 1.0.0 and
 * 1.0.1 releases, so `--version`, the usage header and the `version` field of
 * both JSON reports all named a version that had never been published.
 *
 * `src/cli/` and `dist/cli/` sit at the same depth below the package root, so
 * one relative URL resolves to the same manifest from the sources and from the
 * build.
 */
const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  version: string;
};

export const VERSION = manifest.version;
