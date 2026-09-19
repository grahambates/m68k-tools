import type * as lsp from "vscode-languageserver";
import { DidChangeConfigurationNotification } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { type Provider } from ".";
import {
  type Config,
  defaultConfig,
  mergeConfig,
  symbolsCaseSensitive,
} from "../config";
import { reprocessAll } from "../DocumentProcessor";
import {
  findAssemblyConfigSync,
  optionsFromVasmArgs,
} from "@m68k-lsp/assembly-options";
import { type Context } from "../context";
import { readFileSync, watch } from "fs";
import { dirname, resolve } from "path";

export default class ConfiguratonProvider implements Provider {
  protected clientConfig: Config;

  constructor(protected readonly ctx: Context) {
    this.clientConfig = ctx.config;
    this.updateConfig();
  }

  updateConfig() {
    const before = symbolsCaseSensitive(this.ctx.config);
    const workspaceConfig = this.findWorkspaceConfig();
    this.ctx.config = workspaceConfig
      ? mergeConfig(workspaceConfig, this.clientConfig)
      : this.clientConfig;

    const { caseSensitive, vasm } = this.ctx.config;
    if (
      caseSensitive === true &&
      optionsFromVasmArgs(vasm.args).caseSensitive === false
    )
      this.ctx.logger.warn(
        "caseSensitive is true but the vasm arguments include -nocase: symbols are analysed with case kept, and vasm folds it",
      );

    // Every document's symbols were keyed under the old setting, and nothing
    // else would notice: names that were one symbol are now two, or the reverse.
    if (symbolsCaseSensitive(this.ctx.config) !== before)
      void reprocessAll(this.ctx).catch((error: unknown) =>
        this.ctx.logger.error(
          `Unable to reprocess documents: ${String(error)}`,
        ),
      );
  }

  /** The first workspace folder's project config, found by walking up as the linter does. */
  findWorkspaceConfig(): Partial<Config> | null {
    for (const { uri } of this.ctx.workspaceFolders) {
      const found = findAssemblyConfigSync(URI.parse(uri).fsPath);
      if (!found) continue;
      this.ctx.logger.info("Found workspace config " + found);
      try {
        const config: Partial<Config> = JSON.parse(
          readFileSync(found).toString(),
        );
        // Relative paths mean relative to the file, as they do to the linter,
        // wherever the file is found and wherever vasm is run from.
        if (typeof config.sourceRoot === "string")
          config.sourceRoot = resolve(dirname(found), config.sourceRoot);
        if (Array.isArray(config.includePaths))
          config.includePaths = config.includePaths.map((path) =>
            resolve(dirname(found), path),
          );
        return config;
      } catch (err) {
        if (err instanceof Error) {
          this.ctx.logger.error("Error loading config: " + err.message);
        }
      }
    }
    this.ctx.logger.info("No workspace config found");
    return null;
  }

  async onDidChangeConfiguration() {
    const newConfig =
      await this.ctx.connection.workspace.getConfiguration("m68k");
    this.clientConfig = mergeConfig(newConfig, defaultConfig);
    this.updateConfig();
  }

  register(connection: lsp.Connection, capabilities: lsp.ClientCapabilities) {
    connection.onDidChangeConfiguration(
      this.onDidChangeConfiguration.bind(this),
    );
    const supportsDynamic =
      capabilities.workspace?.didChangeConfiguration?.dynamicRegistration;
    if (supportsDynamic) {
      connection.onInitialized(() => {
        connection.client.register(
          DidChangeConfigurationNotification.type,
          undefined,
        );
      });
    }

    // Watch for .m68krc file changes (debounced)
    let updateConfigTimeout: NodeJS.Timeout;
    for (const { uri } of this.ctx.workspaceFolders) {
      const path = URI.parse(uri).fsPath;
      watch(path, (_, filename) => {
        if (filename?.match(/\.m68krc/i)) {
          clearTimeout(updateConfigTimeout);
          updateConfigTimeout = setTimeout(this.updateConfig.bind(this), 500);
        }
      });
    }

    return {};
  }
}
