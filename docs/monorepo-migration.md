# Monorepo migration status

The existing repository was renamed to `grahambates/m68k-tools`, with `main` as its default branch. Parser, counter, linter, lint language server, counter extension and web application histories were imported without squashing. Original files remain accessible through Git history; obsolete project scaffolding is not retained under `docs/`.

## Current structure and tooling

- Libraries and language servers live in `packages/`; applications and extensions live in `apps/`.
- The assembly and linter language servers remain separate, with separate VS Code extensions.
- Development uses the root-pinned Node 22 and pnpm versions. Published Node packages target 22.15.1 or later; extensions target VS Code 1.101 or later.
- Library builds use tsdown, unit tests use Vitest, and lint/format configuration is owned by the root. Vite, esbuild application builds and integration-test harnesses remain in use.
- Only the root Husky hook, GitHub workflows and VS Code launch configuration are maintained. Package ESLint entry points delegate to the root.
- Changesets manages independent versions and changelogs. The release workflow creates version PRs; automatic publishing is not configured.
- Counter extension packaging stages a generated manifest to preserve Marketplace ID `gigabates.68kcounter`, while its workspace package is named `68kcounter-vscode`.

See the [root README](../README.md) for development and debugging, [release instructions](../.changeset/README.md), and [server documentation](../packages/m68k-lsp-server/README.md).

## Verification completed

Workspace build, lint, formatting, type checks, unit and LSP integration tests, linter coverage thresholds and rule-impact checks passed after tooling consolidation. Isolated npm tarball checks and all three VSIX builds passed. The generated linter rule table was refreshed and its freshness check restored in root CI.

Packed imports and CLI smoke tests passed on Node 22.15.1. Counter extension activation and its existing sample test passed on VS Code 1.101.0. This is startup coverage, not comprehensive extension feature testing; the owner has since performed manual feature testing of all three extensions and the web app. The host test needed the inherited `ELECTRON_RUN_AS_NODE` variable removed.

The counter extension's application code has been upgraded from published counter 3.x to the workspace library (`68kcounter-vscode`'s manifest now depends on `workspace:^`), including new 68030 timings and cache-model support.

The six original source repositories (`68kcounter`, `68kcounter-vscode`, `68kcounter-web`, `m68k-lint`, `m68k-lint-lsp`, `m68k-parser`) each got a README notice pointing to their new location in this repository and were archived on GitHub. None had CI-based release automation to disable.

## Remaining work

- Consider root Dependabot separately. The obsolete nested configuration was removed; no replacement automation was enabled.

The local checkout directory still has its original name. Renaming it is optional and should be done outside the active editor session.
