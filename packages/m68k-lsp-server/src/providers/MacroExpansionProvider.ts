import {
  MacroExpansionRequest,
  type MacroExpansionParams,
  type MacroExpansionResult,
} from "@m68k-lsp/protocol";
import { expandMacro, macroInvocation } from "m68k-parser";
import { Location, Range, type Connection } from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import { findMacroDefinition } from "../macros";

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
    const line = processed.parsed.lines[position.line];
    if (line?.mnemonic?.type !== "macro") return;

    const found = findMacroDefinition(line.mnemonic.macro, uri, this.ctx);
    if (!found) return;

    const lineRange = Range.create(position.line, 0, position.line + 1, 0);
    const source = processed.document.getText(lineRange);
    const expansion = expandMacro(
      found.definition,
      macroInvocation(line, source),
      {
        resolve: (name) => findMacroDefinition(name, uri, this.ctx)?.definition,
      },
    );
    const definitionLine = found.definition.start;
    return {
      name: found.definition.name,
      definition: Location.create(
        found.uri,
        Range.create(definitionLine, 0, definitionLine, 0),
      ),
      lines: expansion.lines.map(({ text, expandedCall }) =>
        expandedCall ? `; ${text.trim()}` : text,
      ),
      incomplete:
        expansion.incomplete ||
        expansion.lines.some(
          ({ line, expandedCall }) =>
            line.mnemonic?.type === "macro" && !expandedCall,
        ),
    };
  }

  register(connection: Connection) {
    connection.onRequest(
      MacroExpansionRequest,
      this.onMacroExpansion.bind(this),
    );
    return {};
  }
}
