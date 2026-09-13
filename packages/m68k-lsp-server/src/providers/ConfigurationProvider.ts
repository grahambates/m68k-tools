import type * as lsp from "vscode-languageserver";
import { DidChangeConfigurationNotification } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { type Provider } from ".";
import { type Config, defaultConfig, mergeConfig } from "../config";
import { type Context } from "../context";
import { join } from "path";
import { readdirSync, readFileSync, watch } from "fs";

export default class ConfiguratonProvider implements Provider {
  protected clientConfig: Config;

  constructor(protected readonly ctx: Context) {
    this.clientConfig = ctx.config;
    this.updateConfig();
  }

  updateConfig() {
    const workspaceConfig = this.findWorkspaceConfig();
    this.ctx.config = workspaceConfig
      ? mergeConfig(workspaceConfig, this.clientConfig)
      : this.clientConfig;
  }

  findWorkspaceConfig(): Partial<Config> | null {
    for (const { uri } of this.ctx.workspaceFolders) {
      const path = URI.parse(uri).fsPath;
      const contents = readdirSync(path);
      const foundPath = contents.find((file) => file.match(/\.m68krc/i));

      if (foundPath) {
        this.ctx.logger.info("Found workspace config " + foundPath);
        try {
          const configJson = readFileSync(join(path, foundPath)).toString();
          return JSON.parse(configJson);
        } catch (err) {
          if (err instanceof Error) {
            this.ctx.logger.error("Error loading config: " + err.message);
          }
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
