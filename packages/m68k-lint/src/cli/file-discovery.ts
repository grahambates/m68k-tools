import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  defaultExtensions,
  matchesGlob as matchGlob,
  walkFiles,
} from "@m68k-lsp/workspace-files";

export const defaultAssemblyExtensions = defaultExtensions;

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

/** Whether a slash-separated path matches a glob, dotfiles included. */
export function matchesGlob(path: string, pattern: string): boolean {
  return matchGlob(path, slash(pattern.replace(/^\.\//, "")));
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
  ignorePatterns: readonly string[],
): boolean {
  const rel = slash(relative(cwd, path));
  return ignorePatterns.some((pattern) => matchesGlob(rel, pattern));
}

export async function discoverFiles(
  inputs: readonly string[],
  options: FileDiscoveryOptions = {},
): Promise<string[]> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const extensions = normalizeExtensions(
    options.extensions ?? defaultAssemblyExtensions,
  );
  const ignorePatterns = options.ignorePatterns ?? [];
  const found = new Set<string>();

  for (const raw of inputs) {
    if (hasGlobMagic(raw)) {
      const absolutePattern = isAbsolute(raw) ? raw : resolve(cwd, raw);
      const base = resolve(globBase(absolutePattern));
      let candidates: string[];
      try {
        candidates = await walkFiles(base, { include: () => true });
      } catch {
        continue;
      }
      const pattern = slash(absolutePattern);
      for (const file of candidates) {
        const absolute = resolve(file);
        if (!matchesGlob(slash(absolute), pattern)) continue;
        if (!matchesExtension(absolute, extensions)) continue;
        if (ignored(absolute, cwd, ignorePatterns)) continue;
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
      if (!ignored(absolute, cwd, ignorePatterns)) found.add(absolute);
      continue;
    }
    if (!info.isDirectory()) continue;

    for (const file of await walkFiles(absolute, { include: () => true })) {
      const resolved = resolve(file);
      if (!matchesExtension(resolved, extensions)) continue;
      if (ignored(resolved, cwd, ignorePatterns)) continue;
      found.add(resolved);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}
