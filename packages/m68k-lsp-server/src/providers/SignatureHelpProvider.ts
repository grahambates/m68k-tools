import type * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { mnemonicDocs, isInstructionDoc } from "../docs/index";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import { componentAtIndex, ComponentType, parseLine } from "../parse";
import { parseSignature } from "../signature";
import { MarkupKind } from "vscode-languageserver";
import { formatAddressingModes } from "../formatting";

export default class SignatureHelpProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onSignatureHelp({
    textDocument,
    position,
  }: lsp.SignatureHelpParams): Promise<lsp.SignatureHelp | null> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) {
      return null;
    }

    const lines = processed.document.getText().split(/\r?\n/g);
    const line = parseLine(lines[position.line]);
    if (!line) {
      return null;
    }

    const mnemonic = line.mnemonic?.value.toLowerCase();
    const info = componentAtIndex(line, position.character);

    const doc = mnemonic && mnemonicDocs[mnemonic];
    if (!doc) {
      return null;
    }
    const signatures = doc.syntax.map(parseSignature);
    if (!signatures.length) {
      return null;
    }

    const activeSignature = 0; // TODO
    let activeParameter = null;

    const hasSize = signatures[activeSignature].size !== undefined;

    switch (info?.type) {
      case ComponentType.Size:
        activeParameter = 0;
        break;
      case ComponentType.Operand:
        activeParameter = info.index ?? 0;
        if (hasSize) {
          activeParameter++;
        }
    }

    // Default to first operand if after mnemonic and last component
    if (activeParameter === null) {
      if (
        line.mnemonic &&
        position.character > line.mnemonic.end &&
        !line.comment &&
        !line.operands
      ) {
        activeParameter = hasSize ? 1 : 0;
      } else {
        return null;
      }
    }

    return {
      signatures: signatures.map(({ label, size, operands }) => {
        const parameters: lsp.ParameterInformation[] = [];
        if (size) {
          parameters.push({
            label: [size.start, size.end],
            documentation: "Size",
          });
        }
        if (operands.length) {
          parameters.push(
            ...operands.map(({ start, end }, i) => {
              const def: lsp.ParameterInformation = {
                label: [start, end],
              };

              if (isInstructionDoc(doc)) {
                let value: string;
                if (i === 0) {
                  value = "Source";
                  if (doc.src) {
                    value = "Source effective address:";
                    value += formatAddressingModes(doc.src);
                  }
                } else {
                  value = "Destination";
                  if (doc.dest) {
                    value = formatAddressingModes(doc.dest);
                  }
                }
                value += "\n\n" + doc.summary;
                def.documentation = { value, kind: MarkupKind.Markdown };
              }
              return def;
            }),
          );
        }
        return {
          label,
          parameters,
        };
      }),
      activeSignature,
      activeParameter,
    };
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onSignatureHelp(this.onSignatureHelp.bind(this));
    return {
      signatureHelpProvider: {
        triggerCharacters: [" ", "\t", ",", "."],
      },
    };
  }
}
