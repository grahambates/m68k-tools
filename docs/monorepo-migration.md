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

Packed imports and CLI smoke tests passed on Node 22.15.1. Counter extension activation and its existing sample test passed on VS Code 1.101.0. This is startup coverage, not comprehensive extension feature testing. The host test needed the inherited `ELECTRON_RUN_AS_NODE` variable removed.

## Remaining work

- Link Vercel to this repository with project root `apps/68kcounter-web`, verify a preview, then use `main` for production. The configuration is prepared; deployment linkage has not been changed.
- Upgrade the counter extension's application code from published counter 3.x to the workspace library. This is deliberately deferred to the owner.
- Perform manual feature and breakpoint checks for all three extensions before release.
- Configure and review npm and Marketplace publishing, including the first releases of the formatter and lint language server. No migration releases or tags have been published.
- Add source-repository notices, disable old release automation where applicable, and archive source repositories once the replacement workflows are proven.
- Consider root Dependabot separately. The obsolete nested configuration was removed; no replacement automation was enabled.

The local checkout directory still has its original name. Renaming it is optional and should be done outside the active editor session.
