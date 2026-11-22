import {
  MacroExpansionRequest,
  type MacroExpansionParams,
  type MacroExpansionResult,
} from "@m68k-lsp/protocol";
import type { Connection } from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import { expandMacroAtLine } from "../macros";

export default class MacroExpansionProvider implements Provider {
  constructor(private readonly ctx: Context) {}

  onMacroExpansion({
    textDocument: { uri },
    documentVersion,
    position,
  }: MacroExpansionParams): MacroExpansionResult | undefined {
    const processed = this.ctx.store.get(uri);
    if (
      !isProcessed(processed) ||
      processed.document.version !== documentVersion
    ) {
      return;
    }
    return expandMacroAtLine(this.ctx, processed, position.line);
  }

  register(connection: Connection) {
    connection.onRequest(
      MacroExpansionRequest,
      this.onMacroExpansion.bind(this),
    );
    return {};
  }
}
