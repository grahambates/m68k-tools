import { evaluateConstant, type ParsedLine, type ValueNode } from "m68k-parser";
import * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
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
    if (!this.ctx.config.inlayHints.enabled) {
      return [];
    }

    const doc = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(doc)) {
      return [];
    }

    // Built up sequentially, matching vasm's requirement that a constant is
    // defined before it is used, so a hint's value never assumes a forward
    // reference that assembly itself would not resolve.
    const known = new Map<string, number>();
    const hints: lsp.InlayHint[] = [];

    for (const [index, line] of doc.parsed.lines.entries()) {
      const value = constantExpression(line);
      if (!value) {
        continue;
      }

      const result = evaluateConstant(value.value, (name) => known.get(name));
      if (!result.known) {
        continue;
      }
      known.set(line.label!.label, result.value);

      // A bare decimal literal already shows its own value in the source.
      // Hex/binary/octal/float literals still gain a decimal hint.
      if (
        value.value.type === "numeric-literal" &&
        value.value.format === "decimal"
      ) {
        continue;
      }
      if (index < range.start.line || index > range.end.line) {
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
