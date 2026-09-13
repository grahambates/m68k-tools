import type { Block, BlockStructure } from "m68k-parser";
import * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import { type Definition, DefinitionType } from "../symbols";

/**
 * Fold ranges for macro, repeat and conditional blocks.
 *
 * A block folds from its opening directive to the line before whatever closes
 * it, and each arm of a conditional folds separately. A block that never
 * closes is left alone, since an unterminated one is the normal state while
 * it is being typed.
 */
function blockRegions(structure: BlockStructure): Array<[number, number]> {
  const regions: Array<[number, number]> = [];

  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.end !== undefined) {
        // Each arm runs to the line before the next divider, or the end.
        const bounds = [block.start, ...block.alternatives, block.end];
        for (let i = 0; i < bounds.length - 1; i++) {
          const start = bounds[i];
          const end = bounds[i + 1] - 1;
          // An empty arm has nothing to fold.
          if (end > start) {
            regions.push([start, end]);
          }
        }
      }
      visit(block.children);
    }
  };
  visit(structure.blocks);

  return regions;
}

export default class FoldingRangeProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onFoldingRanges({
    textDocument,
  }: lsp.FoldingRangeParams): Promise<lsp.FoldingRange[]> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) {
      return [];
    }

    const folds: lsp.FoldingRange[] = [];

    function addRegion(start: number, end: number) {
      folds.push(
        lsp.FoldingRange.create(start, end, undefined, undefined, "region"),
      );
    }

    for (const [start, end] of blockRegions(processed.blocks)) {
      addRegion(start, end);
    }

    const defs = Array.from(processed?.symbols.definitions.values());
    const labels = defs.filter((def) => def.type === DefinitionType.Label);

    let lastLabel: Definition | undefined;
    let lastLocal: Definition | undefined;

    for (const label of labels) {
      if (lastLocal) {
        const start = lastLocal.location.range.start.line;
        const end = label.location.range.start.line - 1;
        folds.push(lsp.FoldingRange.create(start, end));
        lastLocal = undefined;
      }

      if (lastLabel) {
        const start = lastLabel.location.range.start.line;
        const end = label.location.range.start.line - 1;
        addRegion(start, end);
      }
      lastLabel = label;

      if (label.locals) {
        for (const local of label.locals.values()) {
          if (lastLocal) {
            const start = lastLocal.location.range.start.line;
            const end = local.location.range.start.line - 1;
            addRegion(start, end);
          }
          lastLocal = local;
        }
      }
    }

    const end = processed.document.lineCount;
    if (lastLabel) {
      const start = lastLabel.location.range.start.line;
      addRegion(start, end);
    }
    if (lastLocal) {
      const start = lastLocal.location.range.start.line;
      addRegion(start, end);
    }

    return folds;
  }

  register(connection: lsp.Connection) {
    connection.onFoldingRanges(this.onFoldingRanges.bind(this));
    return {
      foldingRangeProvider: true,
    };
  }
}
