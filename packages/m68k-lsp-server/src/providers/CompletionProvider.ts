import * as lsp from "vscode-languageserver";
import { promises as fsp } from "fs";
import { relative } from "path";
import { fileURLToPath } from "url";
import { memoryTypes, sizes } from "m68k-parser";
import type { Size } from "m68k-parser";

import { type Provider } from ".";
import * as syntax from "../syntax";
import {
  directiveDocs,
  instructionDocs,
  mnemonicDocs,
  registerDocs,
  sizeDocs,
} from "../docs/index";
import {
  getDirectory,
  getUnitFiles,
  isAsmExt,
  resolveIncludesGen,
} from "../files";
import {
  type Definition,
  DefinitionType,
  labelBeforePosition,
  processPath,
} from "../symbols";
import { type Context } from "../context";
import { componentAtIndex, ComponentType, parseLine } from "../parse";
import { parseSignature } from "../signature";
import { formatMnemonicDoc } from "../formatting";
import { isProcessed, type ProcessedDocument } from "../DocumentProcessor";

export default class CompletionProvider implements Provider {
  private dataRegs: lsp.CompletionItem[] = [
    { label: "d0", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "d1", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "d2", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "d3", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "d4", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "d5", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "d6", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "d7", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
  ];
  private addrRegs: lsp.CompletionItem[] = [
    { label: "a0", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "a1", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "a2", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "a3", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "a4", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "a5", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "a6", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "a7", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
    { label: "sp", detail: "(register)", kind: lsp.CompletionItemKind.Keyword },
  ];
  private namedRegs: lsp.CompletionItem[];

  constructor(protected readonly ctx: Context) {
    this.namedRegs = syntax.registerNames.map((label) => ({
      label,
      detail: registerDocs[label],
      kind: lsp.CompletionItemKind.Keyword,
    }));
  }

  async onCompletion({
    position,
    textDocument,
  }: lsp.CompletionParams): Promise<lsp.CompletionItem[]> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) {
      return [];
    }

    const lines = processed.document.getText().split(/\r?\n/g);
    const line = parseLine(lines[position.line] ?? "");
    if (!line) {
      return [];
    }

    const info = componentAtIndex(line, position.character);
    const value = info?.component.value ?? "";
    let type = info?.type;
    const mnemonic = line.mnemonic?.value.toLowerCase();
    const doc = mnemonic && mnemonicDocs[mnemonic];
    const signature =
      doc && doc.syntax.length ? parseSignature(doc.syntax[0]) : null; // TODO: find active

    const isUpperCase = value.length > 0 && value.toUpperCase() === value;

    // Default to operand if after mnemonic and last component
    if (!info) {
      if (
        line.mnemonic &&
        position.character > line.mnemonic.end &&
        !line.comment &&
        !line.operands
      ) {
        type = ComponentType.Operand;
      }
    }

    switch (type) {
      case ComponentType.Mnemonic:
        return this.completeMnemonics(isUpperCase, processed, position);
      case ComponentType.Size: {
        // Match case of mnemonic
        const upperCase =
          line.mnemonic !== undefined &&
          line.mnemonic.value.length > 0 &&
          line.mnemonic.value.toUpperCase() === line.mnemonic.value;
        return this.completeSizes(upperCase, signature?.sizes);
      }
      case ComponentType.Operand: {
        if (!mnemonic) {
          return [];
        }
        switch (signature?.operands[info?.index ?? 0].value) {
          case "<file>":
          case "<path>":
            return this.completePath(mnemonic, value, textDocument.uri);
          case "<sec_type>":
            return enumValues(syntax.sectionTypes);
          case "<mem_type>":
            return enumValues(memoryTypes);
          case "<cpu_type>":
            return enumValues(syntax.cpuTypes);
          case "<label>": {
            const symbols = await this.completeAllDefinitions(
              processed,
              position,
            );
            return symbols.filter((n) => n.detail === "(label)");
          }
          case "Rn":
          case "Rx":
          case "Ry": {
            // TODO: register defintions
            const regs = [...this.addrRegs, ...this.dataRegs];
            return this.ucItems(regs, isUpperCase);
          }
          case "An":
          case "Ax":
          case "Ay":
            return this.ucItems(this.addrRegs, isUpperCase);
          case "Dn":
          case "Dx":
          case "Dy":
            return this.ucItems(this.dataRegs, isUpperCase);
          default:
            return this.completeOperands(isUpperCase, processed, position);
        }
      }
      default:
        return [];
    }
  }

  ucItems(items: lsp.CompletionItem[], uppercase: boolean) {
    return uppercase
      ? items.map((reg) => ({
          ...reg,
          label: reg.label.toUpperCase(),
        }))
      : items;
  }

  onCompletionResolve(item: lsp.CompletionItem) {
    if (item.data) {
      const doc = mnemonicDocs[item.label.toLowerCase()];
      if (doc) {
        item.documentation = formatMnemonicDoc(doc);
      }
    }
    return item;
  }

  private completeSizes(uppercase: boolean, sizeValues?: Size[]) {
    return (sizeValues || sizes).map((label, i) => ({
      label: uppercase ? label.toUpperCase() : label,
      detail: sizeDocs[label],
      kind: lsp.CompletionItemKind.Keyword,
      sortText: String(i), // Preserve size order from docs
      preselect: label === "w", // Word is normally default
    }));
  }

  private async completePath(type: string, value: string, docUri: string) {
    const path = processPath(value);
    const completions = new Map<string, lsp.CompletionItem>();
    const dirPath = await getDirectory(path);

    for await (const resolvedDir of resolveIncludesGen(
      docUri,
      dirPath,
      this.ctx,
    )) {
      const { workspaceFolders } = this.ctx;
      const list = await fsp.readdir(resolvedDir);
      let detail: string | undefined;

      // Get relative path of dir to workspace for detail text
      if (workspaceFolders[0]) {
        const wsDir = fileURLToPath(workspaceFolders[0].uri);
        detail = "./" + relative(wsDir, resolvedDir);
      }

      for (const item of list) {
        const itemPath = resolvedDir + "/" + item;
        if (completions.has(itemPath)) {
          continue;
        }

        const stats = await fsp.stat(itemPath);
        const isDir = stats.isDirectory();

        // Only return suitable items for type
        if (
          (!isDir && type === "incdir") ||
          (!isAsmExt(item) && type === "include")
        ) {
          continue;
        }

        completions.set(itemPath, {
          label: isDir ? item + "/" : item,
          kind: isDir
            ? lsp.CompletionItemKind.Folder
            : lsp.CompletionItemKind.File,
          detail,
        });
      }
    }

    return Array.from(completions.values());
  }

  async completeMnemonics(
    isUpperCase: boolean,
    processed: ProcessedDocument,
    position: lsp.Position,
  ): Promise<lsp.CompletionItem[]> {
    const instructions = Object.values(instructionDocs)
      .filter((doc) =>
        this.ctx.config.processors.some((proc) => doc.procs[proc]),
      )
      .map((doc) => {
        const item: lsp.CompletionItem = {
          label: isUpperCase
            ? doc.title.toUpperCase()
            : doc.title.toLowerCase(),
          detail: doc.summary,
          kind: lsp.CompletionItemKind.Function,
        };
        item.data = true;
        return item;
      });

    const directives = Object.values(directiveDocs).map((doc) => {
      return {
        label: isUpperCase ? doc.title.toUpperCase() : doc.title.toLowerCase(),
        detail: doc.summary,
        kind: lsp.CompletionItemKind.Keyword,
        data: true,
      };
    });

    const symbols = await this.completeAllDefinitions(processed, position);
    const macros = symbols.filter(this.isMacro);

    return [...instructions, ...directives, ...macros];
  }

  completeDefinitions(
    definitions: Map<string, Definition>,
  ): lsp.CompletionItem[] {
    return Array.from(definitions.values()).map((def) => {
      const unprefixed = def.name.replace(/^\./, "");
      return {
        label: def.name,
        kind: typeMappings[def.type],
        filterText: unprefixed,
        insertText: unprefixed,
        detail: "(" + def.type + ")",
        documentation: def.comment && {
          kind: lsp.MarkupKind.Markdown,
          value: def.comment,
        },
      };
    });
  }

  async completeOperands(
    isUpperCase: boolean,
    processed: ProcessedDocument,
    position: lsp.Position,
  ) {
    const symbols = await this.completeAllDefinitions(processed, position);
    const withoutMacros = symbols.filter((s) => !this.isMacro(s));
    const registers = this.completeRegisters(isUpperCase);
    return [...withoutMacros, ...registers];
  }

  completeRegisters(isUpperCase: boolean) {
    return this.ucItems(
      [...this.addrRegs, ...this.dataRegs, ...this.namedRegs],
      isUpperCase,
    );
  }

  isMacro(s: lsp.CompletionItem) {
    return s.kind === typeMappings[DefinitionType.Macro];
  }

  async completeAllDefinitions(
    processed: ProcessedDocument,
    position: lsp.Position,
  ) {
    // Only symbols the file can actually reach. Offering every definition in
    // the workspace suggests labels from unrelated programs, and became much
    // more noticeable once the whole workspace was indexed rather than just
    // the files that happened to be open.
    const inScope = [processed.uri, ...getUnitFiles(processed.uri, this.ctx)];
    const globals = inScope.flatMap((uri) => {
      const symbols = this.ctx.store.get(uri)?.symbols;
      return symbols ? this.completeDefinitions(symbols.definitions) : [];
    });

    const lastLabel = labelBeforePosition(processed.symbols, position);
    const locals = lastLabel?.locals
      ? this.completeDefinitions(lastLabel.locals)
      : [];

    return [...globals, ...locals];
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onCompletion(this.onCompletion.bind(this));
    connection.onCompletionResolve(this.onCompletionResolve.bind(this));
    return {
      completionProvider: {
        triggerCharacters: ["."],
        resolveProvider: true,
      },
    };
  }
}

function enumValues(values: readonly string[]): lsp.CompletionItem[] {
  return values.map((label) => ({
    label,
    kind: lsp.CompletionItemKind.Enum,
  }));
}

const typeMappings: Record<DefinitionType, lsp.CompletionItemKind> = {
  [DefinitionType.Section]: lsp.CompletionItemKind.Module,
  [DefinitionType.Label]: lsp.CompletionItemKind.Field,
  [DefinitionType.Macro]: lsp.CompletionItemKind.Function,
  [DefinitionType.Constant]: lsp.CompletionItemKind.Constant,
  [DefinitionType.Variable]: lsp.CompletionItemKind.Variable,
  [DefinitionType.Register]: lsp.CompletionItemKind.Constant,
  [DefinitionType.RegisterList]: lsp.CompletionItemKind.Constant,
  [DefinitionType.Offset]: lsp.CompletionItemKind.Constant,
  [DefinitionType.XRef]: lsp.CompletionItemKind.Field,
};
