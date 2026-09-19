import type {
  DirectiveNode,
  InstructionNode,
  MacroNode,
  NumericLiteralNode,
  SizeNode,
  SpecialRegisterNode,
  StringLiteralNode,
} from "m68k-parser";
import * as lsp from "vscode-languageserver";
import { type TextDocument } from "vscode-languageserver-textdocument";
import { type Provider } from ".";
import { type AstNode, nodeAtPosition } from "../ast";
import { locationAsRange } from "m68k-parser";
import { resolveInclude } from "../files";
import { DefinitionType, getDefinitions } from "../symbols";
import { mnemonicDocs, registerDocs, sizeDocs } from "../docs/index";
import type { Size } from "m68k-parser";
import { type RegisterName } from "../syntax";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import {
  formatDeclaration,
  formatMnemonicDoc,
  formatNumeric,
} from "../formatting";
import { type MarkupContent } from "vscode-languageserver";

export default class HoverProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onHover({
    textDocument,
    position,
  }: lsp.HoverParams): Promise<lsp.Hover | undefined> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) {
      return;
    }

    const path = nodeAtPosition(processed.parsed, position);
    if (!path) {
      return;
    }
    const { node, line } = path;

    switch (node.type) {
      case "instruction":
        return this.hoverMnemonic(
          (node as unknown as InstructionNode).instruction,
          node,
          "instruction",
          position.line,
        );
      case "directive":
        return this.hoverMnemonic(
          (node as unknown as DirectiveNode).directive,
          node,
          "directive",
          position.line,
        );
      case "macro":
        // An unrecognised mnemonic parses as a macro call. Some are directives
        // the parser does not know but the docs do, so still try a lookup, and
        // fall through to no hover rather than labelling it a macro.
        return this.hoverKnownMnemonic(
          (node as unknown as MacroNode).macro,
          node,
          position.line,
        );
      case "size":
        return this.hoverSize(node, position.line);
      // A label is the definition site of a symbol; both resolve through the
      // symbol table, which is what hoverSymbol consults.
      case "symbol":
      case "label":
        return this.hoverSymbol(node, processed.document, position);
      case "string-literal": {
        const directive =
          line.mnemonic?.type === "directive"
            ? line.mnemonic.directive.toLowerCase()
            : undefined;
        if (
          directive === "include" ||
          directive === "incdir" ||
          directive === "incbin"
        ) {
          return this.hoverPath(
            node as unknown as StringLiteralNode,
            textDocument.uri,
            position.line,
          );
        }
        break;
      }
      case "numeric-literal":
        return this.hoverNumber(
          node as unknown as NumericLiteralNode,
          position.line,
        );
      case "special-register":
        return this.hoverRegister(
          node as unknown as SpecialRegisterNode,
          position.line,
        );
    }
  }

  register(connection: lsp.Connection) {
    connection.onHover(this.onHover.bind(this));
    return {
      hoverProvider: true,
    };
  }

  private async hoverMnemonic(
    text: string,
    node: AstNode,
    kind: "instruction" | "directive",
    line: number,
  ) {
    const docs = lookupMnemonicDoc(text);
    return {
      range: locationAsRange(node.loc, line),
      contents: docs || {
        kind: lsp.MarkupKind.PlainText,
        value: `(${kind}) ` + text.toUpperCase(),
      },
    };
  }

  private async hoverKnownMnemonic(text: string, node: AstNode, line: number) {
    const docs = lookupMnemonicDoc(text);
    if (docs) {
      return { range: locationAsRange(node.loc, line), contents: docs };
    }
  }

  private async hoverSize(node: AstNode, line: number) {
    const size = (node as unknown as SizeNode).size;
    const sizeDoc = sizeDocs[size.toLowerCase() as Size];
    return {
      range: locationAsRange(node.loc, line),
      contents: {
        kind: lsp.MarkupKind.PlainText,
        value: sizeDoc || "(size)",
      },
    };
  }

  private async hoverSymbol(
    node: AstNode,
    document: TextDocument,
    position: lsp.Position,
  ) {
    const [def] = await getDefinitions(document.uri, position, this.ctx);
    const contents: lsp.MarkedString[] = [];

    if (def) {
      if (def.comment) {
        contents.push(def.comment); // TODO
      }

      switch (def.type) {
        case DefinitionType.Register:
        case DefinitionType.RegisterList:
        case DefinitionType.Constant:
        case DefinitionType.Variable: {
          // The declaration line is captured when the symbol is recorded, so
          // this works whether or not the defining file is open.
          if (def.declaration) {
            contents.push({
              language: document.languageId,
              value: formatDeclaration(def.declaration),
            });
          }
          break;
        }
        default:
          contents.push(`(${def.type}) ${def.name}`);
      }

      return {
        range: locationAsRange(node.loc, position.line),
        contents,
      };
    }
  }

  private async hoverPath(node: StringLiteralNode, uri: string, line: number) {
    // The node already holds the string with its quotes removed.
    const path = node.content;
    const resolved = await resolveInclude(uri, path, this.ctx);

    return {
      range: locationAsRange(node.loc, line),
      contents: {
        kind: lsp.MarkupKind.Markdown,
        value: resolved || path,
      },
    };
  }

  private async hoverNumber(node: NumericLiteralNode, line: number) {
    return {
      range: locationAsRange(node.loc, line),
      contents: {
        kind: lsp.MarkupKind.Markdown,
        value: formatNumeric(node.raw),
      },
    };
  }

  private async hoverRegister(node: SpecialRegisterNode, line: number) {
    const doc = registerDocs[node.register.toLowerCase() as RegisterName];
    if (doc) {
      return {
        range: locationAsRange(node.loc, line),
        contents: {
          kind: lsp.MarkupKind.Markdown,
          value: doc,
        },
      };
    }
  }
}

function lookupMnemonicDoc(mnemonic: string): MarkupContent | undefined {
  mnemonic = mnemonic.toLowerCase();
  if (mnemonicDocs[mnemonic]) {
    return formatMnemonicDoc(mnemonicDocs[mnemonic]);
  }
}
