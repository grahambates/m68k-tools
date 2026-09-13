import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const defaultAssemblyExtensions = [".s", ".asm", ".i"] as const;

export interface FileDiscoveryOptions {
  cwd?: string;
  extensions?: readonly string[];
  ignorePatterns?: readonly string[];
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) throw new Error("Empty file extension is not valid");
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function normalizeExtensions(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeExtension))];
}

function slash(path: string): string {
  return path.split(sep).join("/");
}

function escapeRegexChar(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

/** Small dependency-free glob subset: *, **, ?, and [] character classes. */
export function globToRegExp(pattern: string): RegExp {
  const p = slash(pattern.replace(/^\.\//, ""));
  let out = "^";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if (ch === "[") {
      const close = p.indexOf("]", i + 1);
      if (close !== -1) {
        let cls = p.slice(i + 1, close);
        if (cls.startsWith("!")) cls = `^${cls.slice(1)}`;
        out += `[${cls}]`;
        i = close;
        continue;
      }
    }
    out += escapeRegexChar(ch);
  }
  out += "$";
  return new RegExp(out);
}

function hasGlobMagic(input: string): boolean {
  return /[*?[\]]/.test(input);
}

function globBase(input: string): string {
  const normalized = slash(input);
  const firstMagic = normalized.search(/[*?[\]]/);
  if (firstMagic < 0) return normalized;
  const slashBefore = normalized.lastIndexOf("/", firstMagic);
  return slashBefore < 0 ? "." : normalized.slice(0, slashBefore) || "/";
}

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await walkFiles(full)));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function matchesExtension(
  path: string,
  extensions: readonly string[],
): boolean {
  const lower = path.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

function ignored(
  path: string,
  cwd: string,
  ignoreRegexes: readonly RegExp[],
): boolean {
  const rel = slash(relative(cwd, path));
  return ignoreRegexes.some((regex) => regex.test(rel));
}

export async function discoverFiles(
  inputs: readonly string[],
  options: FileDiscoveryOptions = {},
): Promise<string[]> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const extensions = normalizeExtensions(
    options.extensions ?? defaultAssemblyExtensions,
  );
  const ignoreRegexes = (options.ignorePatterns ?? []).map(globToRegExp);
  const found = new Set<string>();

  for (const raw of inputs) {
    if (hasGlobMagic(raw)) {
      const absolutePattern = isAbsolute(raw) ? raw : resolve(cwd, raw);
      const base = resolve(globBase(absolutePattern));
      let candidates: string[];
      try {
        candidates = await walkFiles(base);
      } catch {
        continue;
      }
      const regex = globToRegExp(slash(absolutePattern));
      for (const file of candidates) {
        const absolute = resolve(file);
        if (!regex.test(slash(absolute))) continue;
        if (!matchesExtension(absolute, extensions)) continue;
        if (ignored(absolute, cwd, ignoreRegexes)) continue;
        found.add(absolute);
      }
      continue;
    }

    const absolute = resolve(cwd, raw);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      throw new Error(`Input path does not exist: ${raw}`);
    }

    if (info.isFile()) {
      if (!ignored(absolute, cwd, ignoreRegexes)) found.add(absolute);
      continue;
    }
    if (!info.isDirectory()) continue;

    for (const file of await walkFiles(absolute)) {
      const resolved = resolve(file);
      if (!matchesExtension(resolved, extensions)) continue;
      if (ignored(resolved, cwd, ignoreRegexes)) continue;
      found.add(resolved);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}
