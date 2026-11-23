import {
  evaluateConstant,
  symbolKey,
  type ParsedLine,
  type ValueNode,
} from "m68k-parser";
import * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import { symbolsCaseSensitive } from "../config";
import { analyzeDocumentConditionals } from "../documentConditionals";
import { configFor } from "../documentConfigs";
import { isProcessed } from "../DocumentProcessor";
import { locationAsRange } from "m68k-parser";

/** Directives whose operand is a constant expression to evaluate. */
const constantDirectives = new Set(["equ", "fequ", "=", "set"]);

function directiveOf(line: ParsedLine): string | undefined {
  return line.mnemonic?.type === "directive"
    ? line.mnemonic.directive.toLowerCase()
    : undefined;
}

/** The constant assignment's expression, if this line defines one. */
function constantExpression(line: ParsedLine): ValueNode | undefined {
  const directive = directiveOf(line);
  if (!line.label || !directive || !constantDirectives.has(directive)) {
    return undefined;
  }
  const operand = line.operands?.[0];
  return operand?.type === "value" ? (operand as ValueNode) : undefined;
}

export default class InlayHintProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onInlayHint({
    textDocument,
    range,
  }: lsp.InlayHintParams): Promise<lsp.InlayHint[] | null> {
    if (!configFor(this.ctx, textDocument.uri).inlayHints.enabled) {
      return [];
    }

    const doc = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(doc)) {
      return [];
    }

    // The values hover and conditional assembly use: worked out in source
    // order, as vasm decides conditions and SET, with constants that refer to
    // later ones resolved once the whole file is read, as vasm resolves them.
    const { definitionValue, constants, diagnostics } =
      analyzeDocumentConditionals(
        this.ctx,
        textDocument.uri,
        doc.parsed,
        doc.blocks,
      );
    const caseSensitive = symbolsCaseSensitive(
      configFor(this.ctx, textDocument.uri),
    );
    const inactive = diagnostics
      .filter(({ code }) => code === "inactive-conditional")
      .map(({ range }) => range);
    const hints: lsp.InlayHint[] = [];

    for (const [index, line] of doc.parsed.lines.entries()) {
      const value = constantExpression(line);
      if (!value || index < range.start.line || index > range.end.line) {
        continue;
      }
      // Code that does not assemble gets no value.
      if (
        inactive.some(
          ({ start, end }) =>
            index >= start.line &&
            (index < end.line || (index === end.line && end.character > 0)),
        )
      ) {
        continue;
      }

      // Lines the walk does not reach, such as those in a macro body, and FEQU,
      // which is not limited to integers, use the file's constants. SET takes
      // its value where it stands, so only literals can be read without the
      // walk.
      const directive = directiveOf(line);
      const known = directive === "fequ" ? undefined : definitionValue?.(index);
      const result =
        known !== undefined
          ? { known: true as const, value: known }
          : evaluateConstant(value.value, (name) =>
              directive === "set"
                ? undefined
                : constants.get(symbolKey(name, caseSensitive)),
            );
      if (!result.known) {
        continue;
      }

      // A bare decimal literal already shows its own value in the source.
      // Hex/binary/octal/float literals still gain a decimal hint.
      if (
        value.value.type === "numeric-literal" &&
        value.value.format === "decimal"
      ) {
        continue;
      }
      hints.push({
        position: locationAsRange(value.loc, index).end,
        label: ` = ${result.value}`,
        kind: lsp.InlayHintKind.Type,
        paddingLeft: true,
      });
    }

    return hints;
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.languages.inlayHint.on(this.onInlayHint.bind(this));
    return {
      inlayHintProvider: true,
    };
  }
}
