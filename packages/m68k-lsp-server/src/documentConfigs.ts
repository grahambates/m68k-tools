import { findAssemblyConfigSync } from "@m68k-lsp/assembly-options";
import { dirname } from "path";
import type * as lsp from "vscode-languageserver";
import { URI } from "vscode-uri";
import { type Config, mergeConfig, readConfigFile } from "./config";
import { type Context } from "./context";

/**
 * The config for each document: the nearest `.m68krc.json` (or `.m68krc`)
 * found walking up from the document's directory, over the client's settings.
 *
 * A workspace can hold several projects, each with its own config, below the
 * folder the editor opened. That folder's config, the one `Context.config`
 * holds, would say nothing about them, so how a file is assembled is decided
 * from the file. The linter finds its config the same way.
 */
export class DocumentConfigs {
  /** By directory: the config file that applies there, or null for none. */
  private readonly found = new Map<string, string | null>();
  /** By config file: its settings over the client's, or null if unreadable. */
  private readonly loaded = new Map<string, Config | null>();

  constructor(
    private readonly logger: lsp.Logger,
    private base: Config,
    private readonly actualPath?: (path: string) => string | undefined,
  ) {}

  /**
   * Forget everything found and loaded, and take new client settings to lay
   * config files over.
   */
  reset(base: Config): void {
    this.base = base;
    this.clear();
  }

  /** Forget everything found and loaded, as when a config file changes. */
  clear(): void {
    this.found.clear();
    this.loaded.clear();
  }

  /** Read configs through a proposed filesystem change without altering cached configs. */
  project(actualPath: (path: string) => string | undefined): DocumentConfigs {
    return new DocumentConfigs(this.logger, this.base, actualPath);
  }

  /** The config for a document, or undefined when no config file applies to it. */
  for(uri: string): Config | undefined {
    if (!uri.startsWith("file:")) return undefined;
    const dir = dirname(URI.parse(uri).fsPath);
    let path = this.found.get(dir);
    if (path === undefined) {
      try {
        path = findAssemblyConfigSync(dir, this.actualPath) ?? null;
      } catch {
        // An unreadable directory on the way up is not worth failing over.
        path = null;
      }
      this.found.set(dir, path);
    }
    return path ? (this.load(path) ?? undefined) : undefined;
  }

  private load(path: string): Config | null {
    let config = this.loaded.get(path);
    if (config === undefined) {
      try {
        const actual = this.actualPath ? this.actualPath(path) : path;
        config = actual
          ? mergeConfig(readConfigFile(actual, path), this.base)
          : null;
        this.logger.info("Found config " + path);
      } catch (err) {
        this.logger.error(
          `Error loading config ${path}: ${err instanceof Error ? err.message : String(err)}`,
        );
        config = null;
      }
      this.loaded.set(path, config);
    }
    return config;
  }
}

/**
 * The config that decides how a document is assembled and read: the nearest
 * config file to it, else the workspace's.
 *
 * Settings that must agree across every file - whether symbols are case
 * sensitive, which files are indexed - are read from `ctx.config` instead.
 */
export function configFor(
  ctx: Pick<Context, "config"> & Partial<Pick<Context, "documentConfigs">>,
  uri: string,
): Config {
  return ctx.documentConfigs?.for(uri) ?? ctx.config;
}
