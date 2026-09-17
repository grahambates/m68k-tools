import { type Processor } from "./docs";
import { type FormatterOptions, defaultOptions } from "m68k-formatter";
import * as os from "os";
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
