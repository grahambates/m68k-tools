import type * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { mnemonicDocs, isInstructionDoc } from "../docs/index";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import { ComponentType } from "../parse";
import { parseSignature } from "../signature";
import { rankInstructionSignatures } from "../instructionForms";
import { instructionAtCursor, operandsForSignatures } from "../operandHelp";
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

    const { line, component: info } = instructionAtCursor(
      processed,
      position.line,
      position.character,
    );
    const mnemonic = line.mnemonic?.value.toLowerCase();

    const doc = mnemonic && mnemonicDocs[mnemonic];
    if (!doc) {
      return null;
    }
    const signatures = doc.syntax.map(parseSignature);
    if (!signatures.length) {
      return null;
    }

    if (
      info?.type !== ComponentType.Size &&
      info?.type !== ComponentType.Operand
    )
      return null;
    const chosen = isInstructionDoc(doc)
      ? rankInstructionSignatures(
          doc,
          info.type === ComponentType.Size
            ? undefined
            : line.size?.value.toLowerCase(),
          operandsForSignatures(
            this.ctx,
            processed,
            position.line,
            position.character < info.component.end ? info.index : undefined,
          ),
          info.index,
        )[0]
      : undefined;
    const activeSignature = chosen
      ? doc.syntax.indexOf(chosen.signature.label)
      : 0;
    const operandIndex = info.index ?? 0;
    const selected = signatures[activeSignature];
    const sourceParameter =
      chosen && chosen.patterns.length !== selected.operands.length
        ? selected.operands.findIndex(
            ({ value }) => value === chosen.patterns[operandIndex],
          )
        : operandIndex;
    const activeParameter =
      info.type === ComponentType.Size
        ? 0
        : Math.max(0, sourceParameter) + Number(selected.size !== undefined);

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
        triggerCharacters: [","],
      },
    };
  }
}
