import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { TestClient, editsOf, fixture } from "./lsp-client.mjs";

/** Every client is stopped, so a failing assertion cannot leave a server behind. */
function withClient(options = {}) {
  const client = new TestClient(options);
  after(() => client.stop());
  return client;
}

describe("initialize", () => {
  let capabilities;
  before(async () => {
    const client = withClient();
    capabilities = await client.initialize(fixture("basic"));
  });

  it("declares diagnostics and code actions", () => {
    assert.equal(capabilities.textDocumentSync, 2);
    assert.deepEqual(capabilities.codeActionProvider.codeActionKinds, [
      "quickfix",
      "source.fixAll",
    ]);
  });

  /**
   * The coexistence guard. This server is meant to run next to m68k-lsp, and
   * anything it declares here that the other also provides becomes a formatter
   * prompt or a definition picker for the user. Adding a provider should be a
   * deliberate act that fails this test first.
   */
  it("declares nothing that would collide with a full 68k language server", () => {
    for (const provider of [
      "hoverProvider",
      "definitionProvider",
      "completionProvider",
      "documentFormattingProvider",
      "documentRangeFormattingProvider",
      "renameProvider",
      "referencesProvider",
      "documentSymbolProvider",
      "signatureHelpProvider",
    ]) {
      assert.equal(
        capabilities[provider],
        undefined,
        `must not declare ${provider}`,
      );
    }
  });
});

describe("diagnostics", () => {
  it("reports findings with rule id, source and measured impact", async () => {
    const client = withClient();
    await client.initialize(fixture("basic"));
    const { diagnostics } = await client.open(fixture("basic/moveq.s"));

    assert.equal(diagnostics.length, 2);
    const [first] = diagnostics;
    assert.equal(first.code, "optimization/prefer-moveq");
    assert.equal(first.source, "m68k-lint");
    assert.equal(first.severity, 3, "suggestion maps to Information, not Hint");
    assert.match(first.message, /−4 bytes, −8 cycles/);
    // Columns are 0-based on both sides, so they pass through untouched.
    assert.deepEqual(first.range, {
      start: { line: 1, character: 1 },
      end: { line: 1, character: 5 },
    });
  });

  it("honours a project config file over its own defaults", async () => {
    const client = withClient();
    await client.initialize(fixture("configured"));
    const { diagnostics } = await client.open(fixture("configured/moveq.s"));
    assert.deepEqual(diagnostics, [], "m68k-lint.json turns prefer-moveq off");
  });

  it("resolves constants defined in another file", async () => {
    const client = withClient();
    await client.initialize(fixture("includes"));
    const { diagnostics } = await client.open(fixture("includes/main.s"));

    assert.equal(
      diagnostics.length,
      1,
      "MYCONST resolves through the workspace index",
    );
    const notes = diagnostics[0].relatedInformation.map(
      (entry) => entry.message,
    );
    assert.ok(
      notes.some((note) => /MYCONST = 1 \(from defs\.i\)/.test(note)),
      `expected a cross-file note, got ${JSON.stringify(notes)}`,
    );
  });
});

describe("code actions", () => {
  it("offers a quick fix that replaces just the matched line", async () => {
    const client = withClient();
    await client.initialize(fixture("basic"));
    const { uri } = await client.open(fixture("basic/moveq.s"));
    const actions = await client.codeActions(uri, 1);

    const fix = actions.find((action) => action.title.startsWith("Use moveq"));
    assert.ok(
      fix,
      `no quick fix in ${JSON.stringify(actions.map((a) => a.title))}`,
    );
    assert.equal(fix.kind, "quickfix");
    assert.equal(
      fix.isPreferred,
      true,
      "a safe rewrite is the preferred action",
    );
    assert.deepEqual(editsOf(fix, uri), [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: "\tmoveq\t#1,d0\n",
      },
    ]);
  });

  it("writes suppressions the linter understands, at the line's indent", async () => {
    const client = withClient();
    await client.initialize(fixture("basic"));
    const { uri } = await client.open(fixture("basic/moveq.s"));
    const actions = await client.codeActions(uri, 1);

    const line = actions.find((action) =>
      action.title.endsWith("for this line"),
    );
    assert.deepEqual(editsOf(line, uri), [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: "\t; m68k-lint-disable-next-line optimization/prefer-moveq\n",
      },
    ]);

    const file = actions.find((action) =>
      action.title.endsWith("for this file"),
    );
    assert.deepEqual(editsOf(file, uri), [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: "; m68k-lint-disable optimization/prefer-moveq\n",
      },
    ]);
  });

  it("applies every fixable finding under source.fixAll", async () => {
    const client = withClient();
    await client.initialize(fixture("basic"));
    const { uri } = await client.open(fixture("basic/moveq.s"));
    const actions = await client.codeActions(uri, 1);

    const fixAll = actions.find((action) => action.kind === "source.fixAll");
    assert.ok(fixAll, "expected a fix-all action");
    const [edit] = editsOf(fixAll, uri);
    assert.equal(
      edit.newText,
      "start:\n\tmoveq\t#1,d0\n\tmoveq\t#0,d1\n\trts\n",
    );
  });

  describe("conditional suggestions", () => {
    /**
     * BSR/RTS to BRA is `conditional`: it changes the stack depth the callee
     * sees. It spans two lines and replaces them with one, which is also the
     * case that exercises the span arithmetic.
     */
    it("are withheld by default", async () => {
      const client = withClient();
      await client.initialize(fixture("basic"));
      const { uri } = await client.open(fixture("basic/tailcall.s"));
      const actions = await client.codeActions(uri, 1);

      assert.ok(
        actions.every(
          (action) =>
            action.kind !== "quickfix" || action.title.startsWith("Disable"),
        ),
        `expected suppressions only, got ${JSON.stringify(actions.map((a) => a.title))}`,
      );
    });

    it("collapse a multi-line span when enabled", async () => {
      const client = withClient({
        settings: settingsWith({ conditional: true }),
      });
      await client.initialize(fixture("basic"));
      const { uri } = await client.open(fixture("basic/tailcall.s"));
      const actions = await client.codeActions(uri, 1);

      const fix = actions.find((action) => action.title.startsWith("Replace"));
      assert.ok(
        fix,
        `no conditional fix in ${JSON.stringify(actions.map((a) => a.title))}`,
      );
      assert.match(
        fix.title,
        /check the notes/,
        "the assumption must be visible in the title",
      );
      assert.equal(
        fix.isPreferred,
        false,
        "a conditional rewrite is not preferred",
      );
      assert.deepEqual(editsOf(fix, uri), [
        {
          // Two lines out, one line in.
          range: {
            start: { line: 1, character: 0 },
            end: { line: 3, character: 0 },
          },
          newText: "\tbra\tsub\n",
        },
      ]);
    });
  });
});

describe("client capability handling", () => {
  /**
   * Regression: subscribing to workspace-folder changes throws outright when
   * the client never said it sends them, which took the server down for every
   * editor that is not VS Code.
   */
  it("survives a client that does not support workspace folders", async () => {
    const client = withClient({ workspaceFolders: false });
    await client.initialize(fixture("basic"));
    const { diagnostics } = await client.open(fixture("basic/moveq.s"));
    assert.equal(diagnostics.length, 2);
    assert.doesNotMatch(client.stderr, /Client doesn't support/);
  });

  /**
   * Regression: settings used to be pulled only after awaiting the reply to
   * client/registerCapability, so a client slow to answer left the server on
   * defaults indefinitely.
   */
  it("loads settings without waiting on capability registration", async () => {
    const client = withClient({
      registerDelayMs: 3000,
      settings: settingsWith({ conditional: true }),
    });
    await client.initialize(fixture("basic"));
    const { uri } = await client.open(fixture("basic/tailcall.s"));
    const actions = await client.codeActions(uri, 1);

    assert.ok(
      actions.some((action) => action.title.startsWith("Replace")),
      "conditional setting must apply before registration is answered",
    );
  });

  it("reports nothing when disabled", async () => {
    const client = withClient({
      settings: settingsWith({}, { enable: false }),
    });
    await client.initialize(fixture("basic"));
    const { diagnostics } = await client.open(fixture("basic/moveq.s"));
    assert.deepEqual(diagnostics, []);
  });
});

function settingsWith(quickFix, overrides = {}) {
  return {
    enable: true,
    run: "onType",
    defaults: {},
    quickFix: { conditional: false, annotate: false, ...quickFix },
    ...overrides,
  };
}
