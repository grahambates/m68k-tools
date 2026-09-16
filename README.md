# m68k-tools

Tools for Motorola 68000 assembly: parsing, formatting, cycle counting, static analysis and editor integration.

| Directory                       | Purpose                                 |
| ------------------------------- | --------------------------------------- |
| `packages/m68k-parser`          | Assembly parser                         |
| `packages/m68k-formatter`       | Formatter library and CLI               |
| `packages/68kcounter`           | Cycle counter library and CLI           |
| `packages/m68k-lint`            | Static analysis library and CLI         |
| `packages/m68k-lsp-server`      | Assembly language server                |
| `packages/m68k-lint-langserver` | Linter language server                  |
| `packages/protocol`             | Private assembly client/server protocol |
| `apps/m68k-lsp`                 | Assembly VS Code extension              |
| `apps/m68k-lint-vscode`         | Linter VS Code extension                |
| `apps/68kcounter-vscode`        | Cycle counter VS Code extension         |
| `apps/68kcounter-web`           | Vite web application                    |

The two language servers remain independent. The counter extension currently uses the published counter 3.x API; upgrading it to the workspace library is a separate application change.

## Development

Use Node 22.23.2 (`.nvmrc`) and the pinned pnpm version through Corepack:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` builds all projects, runs lint, formatting and type checks, then tests and the linter coverage and rule-impact checks. Libraries build with tsdown, editor applications retain esbuild, and the web app uses Vite. Unit tests use Vitest; LSP transport and VS Code host tests retain their integration runners.

```sh
pnpm --filter m68k-formatter build
pnpm --filter m68k-parser test
pnpm --filter 68kcounter-web dev
pnpm check:packages
pnpm package
pnpm package:assembly
pnpm package:lint
pnpm package:counter
```

`pnpm package` (alias for `pnpm package:extensions`) builds the workspace and creates all three extension VSIX files. After building, use `package:assembly`, `package:lint` or `package:counter` to package just one extension. These commands do not publish anything.

Workspace tests and typechecks run through package-level scripts; TypeScript project references are built before the individual typechecks. The server build scripts also build and stage their corresponding VS Code extensions. `pnpm clean` removes package build outputs, TypeScript build metadata, coverage and extension staging. `pnpm test:coverage:assembly` covers the assembly suites and formatter; linter coverage remains `pnpm --filter m68k-lint test:coverage`.

Build before running the isolated tarball checks. Their consumer fixtures live in `scripts/fixtures/packages` and are copied into a temporary installation to check the actual npm archives. VS Code host tests run separately with `pnpm test:extension-host` and require a graphical display (or Xvfb on Linux). Counter packaging generates `.staging/68kcounter-vscode` and preserves Marketplace identity `gigabates.68kcounter`.

All active projects use the root Prettier configuration and ESLint rules. React-specific checks and the linter’s existing type-aware checks are scoped in the root ESLint configuration. Package lint entry points delegate to the root. Only the root Husky hook is used.

TypeScript projects extend `tsconfig.base.json`; the assembly project-reference graph uses `tsconfig.project.json` for declaration/build metadata. Tsdown package configs retain only their entry/output differences and inherit `tsdown.base.mts`. Ordinary Node test suites use `vitest.package.config.mts`; the linter adds coverage thresholds and the web app retains its Vite/jsdom setup.

## Debugging in VS Code

Open the repository root and choose a component in Run and Debug: `Assembly: Extension`, `Linter: Extension`, `Counter: Extension` or `Counter: Web`. Each launcher builds its dependencies first. The assembly and linter compounds also attach to their server processes, on ports 6009 and 6019 respectively.

`Counter: Extension tests` runs the existing host suite. Counter launches use the staged extension with its Marketplace identity and source maps back to the workspace source. Launch settings are maintained at the root; opening an individual app folder is not required.

The web launcher uses Chrome and starts Vite at `http://127.0.0.1:5173` with a fixed port. Its development server remains running after browser debugging stops; use **Tasks: Terminate Task** to stop `Counter: Start web`. Web source updates use Vite's live reload; restart extension debugging to rebuild extension or library changes.

## Releases

Packages have independent versions. Add a changeset with `pnpm changeset` alongside a user-facing change and commit its Markdown file. The manual release workflow opens a version PR; `pnpm version-packages` consumes pending changesets, updates package versions and dependency ranges, and writes package changelogs. Publishing is not enabled by this migration. See [.changeset/README.md](.changeset/README.md).

Published Node packages target Node 22.15.1 or later; VS Code extensions require 1.101 or later. Development tools require a newer Node 22 minor than the published runtime.

See the [migration record](docs/monorepo-migration.md), [assembly server documentation](packages/m68k-lsp-server/README.md), and [formatter documentation](packages/m68k-formatter/README.md).

## Licences

The workspace projects declare MIT licences, copyright Graham Bates. Third-party dependencies and bundled tools retain their own licences.
