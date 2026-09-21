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

Packages have independent versions, managed with [Changesets](https://github.com/changesets/changesets). Six packages publish to npm (`m68k-parser`, `68kcounter`, `m68k-lint`, `m68k-formatter`, `m68k-lsp-server`, `m68k-lint-langserver`) and three VS Code extensions publish to the Marketplace (`m68k-lsp`, `m68k-lint-vscode`, `68kcounter-vscode`). Published Node packages target Node 22.15.1 or later; the extensions require VS Code 1.101 or later.

### 1. Describe the change

Run `pnpm changeset` with each user-facing change, or write a Markdown file in `.changeset/` by hand, and commit it with the change. Each file names the packages affected, the semver bump for each (`patch`, `minor` or `major`) and a description that becomes the changelog entry. Separate descriptions can be separate files.

**Name the extensions too.** They bundle the servers, so a new server version does not bump them: Changesets only bumps a dependent when the dependency leaves its version range, and the extensions hold theirs within a caret range or as dev dependencies. If a release should ship a new extension version, add a changeset naming it (`m68k-lsp`, `m68k-lint-vscode` or `68kcounter-vscode`), or its Marketplace publish will find the version already taken.

`pnpm exec changeset status` lists what is pending and which packages it bumps.

### 2. Version

```sh
pnpm version-packages
```

This consumes the pending changesets, bumps versions and internal dependency ranges, writes each package's `CHANGELOG.md`, and updates the lockfile. Review the diff, then commit it (for example as `Release packages`). The manual **Version packages** workflow (`workflow_dispatch` on `main`) does the same and opens a pull request, if you would rather review it there.

### 3. Verify

From a clean checkout of the release commit:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm check:packages
```

`pnpm check` builds everything and runs lint, formatting, type checks, tests, the linter coverage and the rule-impact audit. `pnpm check:packages` installs the packed npm archives in an isolated project and exercises them. If you have a vasm binary, `VASM=/path/to/vasmm68k_mot pnpm check:vasm` compares sizes, lint suggestions and syntax with the real assembler (see `scripts/vasm/README.md`).

### 4. Publish to npm

Log in with `npm login`, using an account that can publish all six packages. Then:

```sh
pnpm exec changeset publish
```

This publishes every package whose version is not yet on the registry, in dependency order, and skips the rest, so it is safe to run again after a failure. It also creates a git tag `<name>@<version>` for each package it releases, including the private extensions. It needs an authenticated npm session, and asks for a one-time password if the account has 2FA. Check the result with `npm view <package> version`.

### 5. Publish the extensions

The extensions are private on npm and go to the Marketplace as VSIX files. Publishing needs the `gigabates` publisher's Azure DevOps personal access token, with the **Marketplace: Manage** scope and **All accessible organizations**. It is created under the user settings in Azure DevOps (not on the Marketplace publisher page). Set it up once with `pnpm --filter m68k-lsp exec vsce login gigabates`.

Build and package all three first, to check that they build:

```sh
pnpm package
```

This writes `.vsix` files without publishing. The counter's is `68kcounter-<version>.vsix` at the repository root. Then publish:

```sh
pnpm run publish:extensions   # all three, or one at a time:
pnpm run publish:assembly     # m68k-lsp
pnpm run publish:lint         # m68k-lint-vscode
pnpm run publish:counter      # 68kcounter-vscode
```

Use the `pnpm run publish:*` scripts and not `pnpm publish`: pnpm's own `publish` command runs instead of the package script, and against a private package it reports that there is nothing to publish and does nothing. The counter extension must go through `publish:counter`, not `vsce publish` from `apps/68kcounter-vscode`: its workspace name differs from its Marketplace identity (`gigabates.68kcounter`), and the script stages the renamed manifest and publishes that VSIX by path.

A Marketplace error that the version already exists means the extension was not bumped: go back to step 1.

### 6. Push

```sh
git push --follow-tags
```

This pushes the release commit and the tags. Nothing publishes from CI yet; the workflow only opens version pull requests. npm trusted publishing is planned for the next round, and cannot do the first publish of a new package.

See the [migration record](docs/monorepo-migration.md), [assembly server documentation](packages/m68k-lsp-server/README.md), and [formatter documentation](packages/m68k-formatter/README.md).

## Licences

The workspace projects declare MIT licences, copyright Graham Bates. Third-party dependencies and bundled tools retain their own licences.
