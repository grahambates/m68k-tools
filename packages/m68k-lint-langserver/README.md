# m68k-lint-langserver

A language server exposing [m68k-lint](https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-lint) diagnostics and
quick fixes over LSP, for Motorola 68k assembly.

This package is not published yet. From the monorepo root:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/m68k-lint-langserver/out/server.js --stdio
```

Requires Node.js 22.15.1 or later.

m68k-lint is bundled, so there is nothing else to install.

## Capabilities

Deliberately narrow — `textDocumentSync`, `codeActionProvider` (`quickfix`, `source.fixAll`) and
push diagnostics, and nothing else. This is meant to run alongside a full 68k language server
such as [m68k-lsp-server](https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-lsp-server#readme), and anything it declared that the
other also provides would turn into a formatter prompt or a definition picker for the user.

## Configuration

Reads `m68k-lint.json` / `.m68klintrc.json`, found by walking up from the file being linted.
That file takes precedence over LSP settings.

Settings, under the `m68kLint` section:

```jsonc
{
  "enable": true,
  "run": "onType", // or "onSave"
  "quickFix": {
    "conditional": false, // include conditional replacements in Fix All
    "annotate": false, // keep the original commented above an opaque rewrite
  },
  "defaults": {
    // used only where the workspace has no config file
    "platform": "amiga",
    "processors": ["mc68000"],
    "goal": "balanced",
    "presets": ["recommended"],
    "measureImpact": true,
    "projectSymbols": true,
  },
}
```

## Neovim

```lua
vim.lsp.config("m68k_lint", {
  cmd = { "m68k-lint-langserver", "--stdio" },
  filetypes = { "asm68k", "m68k", "asm" },
  root_markers = { "m68k-lint.json", ".m68klintrc.json", ".git" },
})
vim.lsp.enable("m68k_lint")
```

For diagnostics alone, `m68k-lint --format json` already feeds `none-ls`, `efm-langserver` and
ALE. Code actions — applying a rule's rewrite, writing a suppression comment — are what this
server adds.

## License

MIT
