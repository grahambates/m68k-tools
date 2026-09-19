import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Config, mergeConfig, symbolsCaseSensitive } from "../src/config";
import { type Context } from "../src/context";
import DocumentProcessor, { reprocessAll } from "../src/DocumentProcessor";
import DefinitionProvider from "../src/providers/DefinitionProvider";
import RegisterProvider from "../src/providers/RegisterProvider";
import { createTestContext, range } from "./helpers";
import { defaultConfig } from "../src/config";

/** A context, processor and providers for a config, and a way to open a document. */
async function setup(config: Partial<Config> = {}) {
  const ctx: Context = await createTestContext(config);
  const processor = new DocumentProcessor(ctx);
  return {
    ctx,
    definitions: new DefinitionProvider(ctx),
    registers: new RegisterProvider(ctx),
    open: async (filename: string, text: string) => {
      const uri = ctx.workspaceFolders[0].uri + "/" + filename;
      const document = TextDocument.create(uri, "vasmmot", 0, text);
      await processor.process(document);
      return document;
    },
  };
}

/** The vasm options with `-nocase` among the arguments. */
const nocase = { ...defaultConfig.vasm, args: ["-nocase"] };

describe("symbolsCaseSensitive", () => {
  it("is on by default, as vasm is", () => {
    expect(symbolsCaseSensitive(defaultConfig)).toBe(true);
  });

  it("is off for -nocase in the vasm arguments", () => {
    const config = mergeConfig({ vasm: nocase }, defaultConfig);
    expect(symbolsCaseSensitive(config)).toBe(false);
  });

  it("is what the setting says, over the vasm arguments", () => {
    const on = mergeConfig(
      { caseSensitive: true, vasm: nocase },
      defaultConfig,
    );
    expect(symbolsCaseSensitive(on)).toBe(true);
    const off = mergeConfig({ caseSensitive: false }, defaultConfig);
    expect(symbolsCaseSensitive(off)).toBe(false);
  });
});

describe("definitions and case", () => {
  const source = "Foo = 1\nfoo = 2\n move #Foo,d0\n move #foo,d1\n";

  it("keeps Foo and foo apart by default", async () => {
    const { definitions, open } = await setup();
    const textDocument = await open("case-default.s", source);

    const first = await definitions.onDefinition({
      position: lsp.Position.create(2, 8),
      textDocument,
    });
    expect(first.map((d) => d.range)).toEqual([range(0, 0, 0, 7)]);

    const second = await definitions.onDefinition({
      position: lsp.Position.create(3, 8),
      textDocument,
    });
    expect(second.map((d) => d.range)).toEqual([range(1, 0, 1, 7)]);
  });

  it("finds nothing for a name only defined in another case", async () => {
    const { definitions, open } = await setup();
    const textDocument = await open(
      "case-missing.s",
      "Foo = 1\n move #foo,d0\n",
    );
    const found = await definitions.onDefinition({
      position: lsp.Position.create(1, 8),
      textDocument,
    });
    expect(found).toHaveLength(0);
  });

  it("finds it when case is folded", async () => {
    const { definitions, open } = await setup({ caseSensitive: false });
    const textDocument = await open(
      "case-folded.s",
      "Foo = 1\n move #foo,d0\n",
    );
    const found = await definitions.onDefinition({
      position: lsp.Position.create(1, 8),
      textDocument,
    });
    expect(found.map((d) => d.range)).toEqual([range(0, 0, 0, 7)]);
  });

  it("folds case for -nocase in the vasm arguments", async () => {
    const { definitions, open } = await setup({ vasm: nocase });
    const textDocument = await open(
      "case-nocase.s",
      "Foo = 1\n move #foo,d0\n",
    );
    const found = await definitions.onDefinition({
      position: lsp.Position.create(1, 8),
      textDocument,
    });
    expect(found).toHaveLength(1);
  });

  it("tells .Loop from .loop by default, and not when folded", async () => {
    const text = "main:\n.Loop:\n.loop:\n bra .Loop\n";
    const sensitive = await setup();
    const doc = await sensitive.open("case-locals.s", text);
    const found = await sensitive.definitions.onDefinition({
      position: lsp.Position.create(3, 7),
      textDocument: doc,
    });
    expect(found.map((d) => d.range)).toEqual([range(1, 0, 1, 6)]);
  });
});

describe("macros and case", () => {
  const source = "Paint macro\n move.w d\\1,d2\n endm\n paint 4\n";
  const usage = (
    registers: RegisterProvider,
    textDocument: TextDocument,
    end: number,
  ) =>
    registers.onRegisterUsage({
      textDocument,
      range: range(3, 0, end, 0),
    });

  it("does not expand a call in another case by default", async () => {
    const { registers, open } = await setup();
    const textDocument = await open("macro-default.s", source);
    const result = usage(registers, textDocument, 4);
    const d4 = result?.registers.find((usage) => usage.name === "d4");
    expect(
      d4?.references.some((r) => r.kind === "macro-expansion"),
    ).toBeFalsy();
  });

  it("expands it when case is folded", async () => {
    const { registers, open } = await setup({ caseSensitive: false });
    const textDocument = await open("macro-folded.s", source);
    const result = usage(registers, textDocument, 4);
    const d4 = result?.registers.find((usage) => usage.name === "d4");
    expect(d4?.references.some((r) => r.kind === "macro-expansion")).toBe(true);
  });

  it("expands a call in the same case", async () => {
    const { registers, open } = await setup();
    const textDocument = await open(
      "macro-same.s",
      "Paint macro\n move.w d\\1,d2\n endm\n Paint 4\n",
    );
    const result = usage(registers, textDocument, 4);
    const d4 = result?.registers.find((usage) => usage.name === "d4");
    expect(d4?.references.some((r) => r.kind === "macro-expansion")).toBe(true);
  });
});

describe("changing the setting", () => {
  it("re-keys documents that were already processed", async () => {
    const { ctx, definitions, open } = await setup();
    const textDocument = await open(
      "case-change.s",
      "Foo = 1\n move #foo,d0\n",
    );
    const at = {
      position: lsp.Position.create(1, 8),
      textDocument,
    };
    expect(await definitions.onDefinition(at)).toHaveLength(0);

    ctx.config = mergeConfig({ caseSensitive: false }, ctx.config);
    await reprocessAll(ctx);

    expect(await definitions.onDefinition(at)).toHaveLength(1);
  });
});
