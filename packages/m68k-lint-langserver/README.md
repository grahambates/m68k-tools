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

Files matched by the config's `ignores` are not linted here either, the same as on the
command line: they get no findings and no code actions. They are still read for the constants
and macros they define, so ignoring a system include stops its unused symbols being reported
without leaving the constants in it unresolved. Patterns are relative to the config file.

`includePaths` in the config are the directories the assembler searches for includes, as in
the assembly language server. Includes the linter finds through them, beside a file, in the
directory of a main source, through an `incdir`, or in one of those directories, are read for the constants and macros they define even when they are
outside the workspace, and are never linted.

Settings, under the `m68kLint` section:

```jsonc
{
  "enable": true,
  "run": "onType", // or "onSave"
  "quickFix": {
    "conditional": false, // include conditional replacements in Fix All
    "annotate": "obfuscated", // or "all" / "none"; project fixAnnotate takes precedence
  },
  "defaults": {
    // used only where the workspace has no config file
    "platform": "amiga",
    "processors": ["mc68000"],
    "goal": "balanced",
    "presets": ["recommended"],
    "measureImpact": true,
    "projectSymbols": true, // constants and macros defined in other files
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
ALE. Code actions — applying a rule's rewrite, writing a suppression comment, ignoring the file — are what this
server adds.

## License

MIT
