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
import { isLocalLabelName, locationAsRange } from "m68k-parser";
import { resolveInclude } from "../files";
import { DefinitionType, escapeMarkdown, getDefinitions } from "../symbols";
import {
  type RoutineRegisters,
  canonicalGeneralPurposeRegister,
  createAliasResolver,
  registerName,
  routineRegisters,
} from "../registerAnalysis";
import {
  describeRegister,
  routineContract,
  type RegisterDescriptionResult,
} from "../registerDescriptions";
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
      case "data-register":
      case "address-register":
        return this.hoverGeneralRegister(node, textDocument.uri, position);
      case "register-list":
        return this.hoverRegisterList(node, textDocument.uri, position);
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
          // What an alias for a single register holds here, as for the
          // register itself.
          const [register, ...more] =
            def.type === DefinitionType.Register
              ? (createAliasResolver(this.ctx, document.uri)(def.name) ?? [])
              : [];
          const described =
            register && !more.length
              ? describeRegister(this.ctx, document.uri, position, register)
              : undefined;
          if (register && described) {
            contents.push(formatRegisterDescription(register, described));
          }
          break;
        }
        default: {
          contents.push(`(${def.type}) ${def.name}`);
          const summary =
            def.type === DefinitionType.Label && !isLocalLabelName(def.name)
              ? routineRegisters(
                  this.ctx,
                  def.location.uri,
                  def.selectionRange.start.line,
                  (name) => routineContract(this.ctx, def.location.uri, name),
                )
              : undefined;
          const text = summary && formatRoutineRegisters(summary);
          if (text) {
            contents.push(text);
          }
        }
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

  /** The descriptions of the registers in a list that have one. */
  private async hoverRegisterList(
    node: AstNode,
    uri: string,
    position: lsp.Position,
  ) {
    const registers = (node as AstNode & { registers?: unknown }).registers;
    const sections = (Array.isArray(registers) ? registers : []).flatMap(
      (item) => {
        const register = canonicalGeneralPurposeRegister(item);
        const result =
          register && describeRegister(this.ctx, uri, position, register);
        return register && result
          ? [formatRegisterDescription(register, result)]
          : [];
      },
    );
    if (!sections.length) {
      return;
    }
    return {
      range: locationAsRange(node.loc, position.line),
      contents: {
        kind: lsp.MarkupKind.Markdown,
        value: sections.join("\n\n***\n\n"),
      },
    };
  }

  private async hoverGeneralRegister(
    node: AstNode,
    uri: string,
    position: lsp.Position,
  ) {
    const register = registerName(node);
    const result =
      register && describeRegister(this.ctx, uri, position, register);
    if (!result) {
      return;
    }
    return {
      range: locationAsRange(node.loc, position.line),
      contents: {
        kind: lsp.MarkupKind.Markdown,
        value: formatRegisterDescription(register, result),
      },
    };
  }
}

/**
 * What a routine does with registers, as `Reads D0 · Modifies D0–D1/A0`,
 * noting where code it runs could not be analysed.
 */
function formatRoutineRegisters(summary: RoutineRegisters): string | undefined {
  const reads =
    summary.reads.length || summary.mayReadOthers
      ? `Reads ${
          summary.reads.length
            ? formatRegisterList(summary.reads) +
              (summary.mayReadOthers ? " and possibly others" : "")
            : "possibly any"
        }`
      : undefined;
  // What code that could not be analysed may change, unless it is saved on
  // the stack around that code. Named when it is not everything left.
  // The stack pointer is never in a summary, so D0-D7 and A0-A6 are all.
  const others = 15 - summary.modifies.length;
  const possibly = summary.mayModify.length
    ? summary.mayModify.length === others
      ? summary.modifies.length
        ? "and possibly others"
        : "possibly any"
      : `${summary.modifies.length ? "and possibly " : "possibly "}${formatRegisterList(summary.mayModify)}`
    : undefined;
  const modifies =
    summary.modifies.length || possibly
      ? `Modifies ${[
          summary.modifies.length
            ? formatRegisterList(summary.modifies)
            : undefined,
          possibly,
        ]
          .filter(Boolean)
          .join(" ")}`
      : undefined;
  const parts = [reads, modifies].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** Registers in MOVEM-list form: `D0–D2/A0`. */
function formatRegisterList(registers: string[]): string {
  const groups: string[] = [];
  for (const kind of ["d", "a"]) {
    const numbers = registers
      .filter((register) => register[0] === kind)
      .map((register) => Number(register[1]))
      .sort((a, b) => a - b);
    for (let i = 0; i < numbers.length; i++) {
      let j = i;
      while (numbers[j + 1] === numbers[j] + 1) {
        j++;
      }
      const first = `${kind.toUpperCase()}${numbers[i]}`;
      groups.push(
        j === i ? first : `${first}–${kind.toUpperCase()}${numbers[j]}`,
      );
      i = j;
    }
  }
  return groups.join("/");
}

function formatRegisterDescription(
  register: string,
  { current, output, routine }: RegisterDescriptionResult,
): string {
  const name = `**${register.toUpperCase()}**`;
  const sections: string[] = [];
  if (current) {
    const text = [
      escapeMarkdown(current.text),
      ...(current.code ? ["`" + current.code + "`"] : []),
    ]
      .filter(Boolean)
      .join(" ");
    const line = current.line + 1;
    const origin = {
      header: `Input, header of ${escapeMarkdown(current.routine ?? "")}`,
      comment: `Comment, line ${line}`,
      "inferred-comment": `Inferred from comment, line ${line}`,
      operand: `Assigned on line ${line}`,
      call: `Output of ${escapeMarkdown(current.routine ?? "")}, line ${line}`,
    }[current.source];
    sections.push(`${name}: ${text}`, `*${origin}*`);
  }
  if (output) {
    const target = routine ? ` of ${escapeMarkdown(routine)}` : "";
    sections.push(
      current
        ? `Output${target}: ${escapeMarkdown(output)}`
        : `${name}: output${target}, ${escapeMarkdown(output)}`,
    );
  }
  return sections.join("\n\n");
}

function lookupMnemonicDoc(mnemonic: string): MarkupContent | undefined {
  mnemonic = mnemonic.toLowerCase();
  if (mnemonicDocs[mnemonic]) {
    return formatMnemonicDoc(mnemonicDocs[mnemonic]);
  }
}
