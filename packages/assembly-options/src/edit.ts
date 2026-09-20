import { isAbsolute, relative } from "node:path";

export interface ConfigChange {
  /** A directory to add to `includePaths`. Absolute. */
  includePath?: string;
  /** The directory to set `sourceRoot` to. Absolute. */
  sourceRoot?: string;
}

/** A directory as the config should spell it: relative to the config where it is inside it. */
function spelled(dir: string, configDir: string): string {
  const path = relative(configDir, dir);
  if (path === "") return ".";
  return path.startsWith("..") || isAbsolute(path) ? dir : path;
}

/**
 * The text of a project config with a change made to it.
 *
 * Only the keys asked for are touched, and the rest is left as it is, though
 * the file is written out again in the usual two-space form. `text` is
 * undefined when there is no config yet, which gives a new one. Returns
 * undefined if the text is not a JSON object, which is not for this to repair.
 */
export function editAssemblyConfig(
  text: string | undefined,
  change: ConfigChange,
  configDir: string,
): string | undefined {
  let config: Record<string, unknown> = {};
  if (text !== undefined && text.trim() !== "") {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return undefined;
      config = parsed;
    } catch {
      return undefined;
    }
  }

  if (change.includePath !== undefined) {
    const path = spelled(change.includePath, configDir);
    const current = Array.isArray(config.includePaths)
      ? (config.includePaths as unknown[])
      : [];
    if (!current.includes(path)) config.includePaths = [...current, path];
  }
  if (change.sourceRoot !== undefined)
    config.sourceRoot = spelled(change.sourceRoot, configDir);

  return `${JSON.stringify(config, null, 2)}\n`;
}
