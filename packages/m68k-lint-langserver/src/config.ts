import type { FixAnnotation } from "m68k-lint";
import { dirname, relative, sep } from "node:path";
import { defaultConfig, type LintConfig } from "m68k-lint";
import {
  configIgnores,
  configIncludePaths,
  configSourceRoot,
  findProjectConfig,
  isIgnored,
  knownProcessors,
  loadProjectConfig,
  lintConfigFromProject,
} from "m68k-lint/project-config";
import {
  findAssemblyConfig,
  loadAssemblyOptions,
  mergeOptions,
  searchPaths,
  type AssemblyOptions,
} from "@m68k-lsp/assembly-options";

/**
 * Editor settings, under the `m68kLint` section.
 *
 * The lint-semantic fields mirror the project config file, but the file wins
 * where both speak. A checked-in `m68k-lint.json` is what makes a team's
 * results match; per-user settings quietly overriding it is how "works on my
 * machine" starts. These apply when a workspace has no config file at all.
 */
export interface Settings {
  enable: boolean;
  run: "onType" | "onSave";
  /** Fall back to these when the workspace has no config file. */
  defaults: Partial<LintConfig>;
  quickFix: {
    /** Include conditional fixes in Fix All; individual actions always allow review. */
    conditional: boolean;
    /** Keep the original commented above an opaque rewrite. */
    annotate: FixAnnotation;
  };
}

export const defaultSettings: Settings = {
  enable: true,
  run: "onType",
  defaults: {},
  quickFix: { conditional: false, annotate: "obfuscated" },
};

/** Drops the keys a source left unset, so a spread does not erase what is under it. */
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export interface ResolvedConfig {
  config: LintConfig;
  /** Absolute path of the config file backing this, if any. */
  configPath?: string;
  /** Set when a config file was found but could not be read or validated. */
  error?: string;
  /** The config's `ignores`: files it leaves out of linting. */
  ignores?: readonly string[];
  /** Where includes are looked for after the file's own directory: the source root, then the config's and the shared file's include paths, all absolute. */
  includePaths?: readonly string[];
  /** Things about the config files worth telling the user that are not errors. */
  warnings?: readonly string[];
}

/**
 * Resolves and caches the lint config that applies to a file.
 *
 * Cached per containing directory rather than per file: the walk up to the
 * nearest config file is the expensive part, and every file in a directory
 * shares its answer.
 */
export class ConfigResolver {
  private cache = new Map<string, Promise<ResolvedConfig>>();
  private settings: Settings = defaultSettings;

  getSettings(): Settings {
    return this.settings;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    // Settings feed the resolved config, so every cached answer is now stale.
    this.clear();
  }

  clear(): void {
    this.cache.clear();
  }

  resolve(fsPath: string): Promise<ResolvedConfig> {
    const dir = dirname(fsPath);
    let resolved = this.cache.get(dir);
    if (!resolved) {
      resolved = this.load(dir);
      this.cache.set(dir, resolved);
    }
    return resolved;
  }

  /**
   * Whether the project's config leaves this file out of linting.
   *
   * Patterns are relative to the config file's directory, as they are for the
   * command line, so the two agree about which files are ignored. A file outside
   * that directory is never ignored by it.
   */
  async isIgnored(fsPath: string): Promise<boolean> {
    const { configPath, ignores } = await this.resolve(fsPath);
    if (!configPath) return false;
    const relativePath = relative(dirname(configPath), fsPath)
      .split(sep)
      .join("/");
    if (relativePath.startsWith("..")) return false;
    return isIgnored(relativePath, ignores ?? []);
  }

  private async load(dir: string): Promise<ResolvedConfig> {
    // Layered, each over the one before: the editor's defaults, how the source is
    // assembled (from the shared .m68krc.json), then the lint config itself.
    const editor: LintConfig = {
      ...defaultConfig,
      fixAnnotate: this.settings.quickFix.annotate,
      ...this.settings.defaults,
    };
    const { shared, warnings } = await this.loadShared(dir);
    const base: LintConfig = {
      ...editor,
      ...defined({
        processors: knownProcessors(shared.processors),
        caseSensitive: shared.caseSensitive,
      }),
    };

    let configPath: string | undefined;
    try {
      configPath = await findProjectConfig(dir);
    } catch {
      // An unreadable directory on the way up is not worth failing the file for.
      configPath = undefined;
    }
    if (!configPath)
      return {
        config: base,
        includePaths: searchPaths(shared.includePaths, shared.sourceRoot),
        warnings,
      };

    try {
      const project = await loadProjectConfig(configPath);
      // lintConfigFromProject returns every key, undefined where the file was
      // silent. Spreading that as-is would erase the defaults underneath.
      const overrides = defined(lintConfigFromProject(project));
      return {
        config: { ...base, ...overrides },
        configPath,
        ignores: configIgnores(project),
        includePaths: searchPaths(
          mergeOptions(
            { includePaths: configIncludePaths(project, dirname(configPath)) },
            { includePaths: shared.includePaths },
          ).includePaths,
          configSourceRoot(project, dirname(configPath)) ?? shared.sourceRoot,
        ),
        warnings,
      };
    } catch (error) {
      return {
        config: base,
        configPath,
        error: error instanceof Error ? error.message : String(error),
        warnings,
      };
    }
  }

  /** The shared options for how the source is assembled, if there is a file for them. */
  private async loadShared(
    dir: string,
  ): Promise<{ shared: AssemblyOptions; warnings: string[] }> {
    try {
      const found = await findAssemblyConfig(dir);
      if (!found) return { shared: {}, warnings: [] };
      const { options, warnings } = await loadAssemblyOptions(found);
      return {
        shared: options,
        warnings: warnings.map((w) => `${found}: ${w}`),
      };
    } catch (error) {
      // A shared file that cannot be read is worth saying, but not worth
      // withholding findings over.
      return {
        shared: {},
        warnings: [error instanceof Error ? error.message : String(error)],
      };
    }
  }
}
