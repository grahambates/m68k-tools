# M68k Lint

Static analysis, correctness checks and optimization hints for Motorola 68k assembly, powered by
[m68k-lint](https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-lint).

- Findings appear as you type, with measured impact:
  `Immediate 1 fits the MOVEQ signed 8-bit range (−4 bytes, −8 cycles)`.
- Quick fixes apply a rule's suggested rewrite. They go through the same code path as
  `m68k-lint --fix`, so the editor and the command line agree.
- Suppress a rule for a line or a file from the lightbulb, written as the
  `; m68k-lint-disable` comments the linter understands.
- **Fix all** applies every safe, improving rewrite in the file at once.
- Constants defined in an include elsewhere in the workspace are resolved, so rules that need a
  value still fire.

## Works alongside M68k Assembly Language Server

This extension provides diagnostics and quick fixes only — no hover, completion, definition or
formatting. Install it next to [`gigabates.m68k-lsp`](https://marketplace.visualstudio.com/items?itemName=gigabates.m68k-lsp)
and the two do not collide: that one reports what vasm says won't assemble, this one reports
what assembles fine but is wrong, suspicious or slow.

## Configuration

Add a `m68k-lint.json` to your project (`m68k-lint --init` writes one). It is found by walking
up from the file being linted, and it takes precedence over this extension's settings — so a
config file checked into a repo gives everyone on the team the same results.

```json
{
  "platform": "amiga",
  "processors": ["mc68000"],
  "goal": "size",
  "rules": { "style/label-case": "off" }
}
```

Where a workspace has no config file, `m68kLint.defaults.*` supplies the platform, CPUs, goal
and presets instead.

### Fix on save

```jsonc
"editor.codeActionsOnSave": { "source.fixAll": "explicit" }
```

### Conditional fixes

Some rewrites are only equivalent under an assumption the rule states in its notes — replacing
`BSR`/`RTS` with `BRA` changes the stack depth the callee sees, for instance. These are hidden
by default. Set `m68kLint.quickFix.conditional` to `true` to be offered them; the action title
says to check the notes, and the notes are on the finding.

## License

MIT

## Development

This extension is not released yet. Requires VS Code 1.101 or later. Open the monorepo root and choose **Linter: Extension** in Run and Debug. To create a VSIX, run `pnpm build` then `pnpm --filter m68k-lint-vscode package` at the root.
