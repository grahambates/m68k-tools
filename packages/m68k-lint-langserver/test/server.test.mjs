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
    assert.match(first.message, /saves: 4 bytes, 8\(2,0\) cycles/);
    // Columns are 0-based on both sides, so they pass through untouched.
    assert.deepEqual(first.range, {
      start: { line: 1, character: 1 },
      end: { line: 1, character: 13 },
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
  it("offers both equal-cost alternatives under one diagnostic", async () => {
    const client = withClient();
    await client.initialize(fixture("basic"));
    const { uri, diagnostics } = await client.open(
      fixture("basic/alternatives.s"),
    );
    assert.equal(diagnostics.filter((d) => d.range.start.line === 0).length, 1);
    const actions = await client.codeActions(uri, 0);
    const fixes = actions.filter(
      (a) => a.title.includes("NOT.B") || a.title.includes("ADD.B"),
    );
    assert.equal(fixes.length, 2);
    assert.ok(fixes.every((a) => !a.isPreferred));
    assert.ok(fixes.some((a) => editsOf(a, uri)[0].newText.includes("not.b")));
    assert.ok(fixes.some((a) => editsOf(a, uri)[0].newText.includes("add.b")));
  });

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
    assert.match(fix.title, /saves: 4 bytes, 8\(2,0\) cycles/);
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
    it("are offered on either line by default, but excluded from fix-all", async () => {
      const client = withClient();
      await client.initialize(fixture("basic"));
      const { uri, diagnostics } = await client.open(
        fixture("basic/tailcall.s"),
      );
      const finding = diagnostics.find(
        (d) => d.message.includes("BSR") || d.range.start.line === 1,
      );
      assert.equal(finding.range.start.line, 1);
      assert.equal(finding.range.end.line, 2);
      for (const line of [1, 2]) {
        const actions = await client.codeActions(uri, line);
        const fix = actions.find((a) => a.title.startsWith("Replace"));
        assert.ok(fix);
        assert.match(fix.title, /conditional.*check the notes/);
        assert.equal(fix.isPreferred, false);
        assert.equal(editsOf(fix, uri)[0].range.end.line, 3);
        assert.ok(!actions.some((a) => a.kind === "source.fixAll"));
      }
      const outside = await client.codeActions(uri, 3);
      assert.ok(!outside.some((a) => a.title.startsWith("Replace")));
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
