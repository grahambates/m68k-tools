import { type Processor } from "./docs";
import { type FormatterOptions, defaultOptions } from "m68k-formatter";
import * as os from "os";
import { optionsFromVasmArgs, vasmArgs } from "@m68k-lsp/assembly-options";
import { type VasmOptions } from "./diagnostics";

export interface InlayHintOptions {
  enabled: boolean;
}

export interface Config {
  format: FormatterOptions;
  /**
   * Glob patterns to leave out of the workspace index, on top of the built-in
   * ones for build output and dependency directories.
   */
  exclude: string[];
  includePaths: string[];
  /**
   * Whether `Foo` and `foo` are different symbols. They are unless vasm was
   * given `-nocase`, so this defaults to that; leave it unset and a `-nocase` in
   * the vasm arguments is honoured instead.
   */
  caseSensitive?: boolean;
  processors: Processor[];
  vasm: VasmOptions;
  inlayHints: InlayHintOptions;
}

export const defaultConfig: Config = {
  format: defaultOptions,
  exclude: [],
  includePaths: [],
  processors: ["mc68000"],
  vasm: {
    provideDiagnostics: true,
    preferWasm: false,
    binPath: os.platform() === "win32" ? "vasmm68k_mot.exe" : "vasmm68k_mot",
    args: [],
    exclude: [],
  },
  inlayHints: {
    enabled: true,
  },
};

export function mergeConfig(
  config: Partial<Config>,
  defaultConfig: Config,
): Config {
  return {
    ...defaultConfig,
    ...config,
    format: {
      ...defaultConfig.format,
      ...config?.format,
      align: {
        ...defaultConfig.format.align,
        ...config?.format?.align,
      },
    },
    vasm: {
      ...defaultConfig.vasm,
      ...config?.vasm,
    },
    inlayHints: {
      ...defaultConfig.inlayHints,
      ...config?.inlayHints,
    },
  };
}

/** Whether symbol names keep their case: the setting, else whether vasm was told not to. */
export function symbolsCaseSensitive(config: Config): boolean {
  return (
    config.caseSensitive ??
    optionsFromVasmArgs(config.vasm.args).caseSensitive ??
    true
  );
}

/**
 * The vasm arguments to run with: the custom ones, then those that follow from the
 * options written in the friendly form, so `includePaths`, `processors` and
 * `caseSensitive` are told to vasm as they are to everything else that reads them.
 */
export function assemblerArgs(config: Config): string[] {
  return vasmArgs(
    {
      includePaths: config.includePaths,
      processors: config.processors,
      caseSensitive: symbolsCaseSensitive(config),
    },
    config.vasm.args,
  );
}
