# Working in m68k-tools

This is a pnpm workspace for Motorola 68k assembly tooling. Run commands from the repository root unless a package command requires otherwise. Read the affected package's README and implementation before changing its behaviour; migration notes describe historical decisions and may not reflect current support.

## Repository map

| Location                        | Responsibility                                           |
| ------------------------------- | -------------------------------------------------------- |
| `packages/m68k-parser`          | Assembly AST and expression parsing/evaluation           |
| `packages/m68k-formatter`       | Formatter library and CLI                                |
| `packages/68kcounter`           | Instruction sizes, CPU timings, counter library and CLI  |
| `packages/m68k-lint`            | Static analysis, optimisation rules and CLI              |
| `packages/m68k-lsp-server`      | Assembly language server                                 |
| `packages/m68k-lint-langserver` | Independent linter language server                       |
| `packages/protocol`             | Private assembly client/server protocol                  |
| `packages/workspace-files`      | Private shared workspace file discovery for both servers |
| `apps/m68k-lsp`                 | Assembly VS Code extension                               |
| `apps/m68k-lint-vscode`         | Linter VS Code extension                                 |
| `apps/68kcounter-vscode`        | Counter VS Code extension, using the workspace counter   |
| `apps/68kcounter-web`           | React/Vite counter application                           |
| `scripts`                       | Shared build, packaging and verification scripts         |

Keep the assembly and linter language servers separate. Put shared parsing, evaluation and timing behaviour in libraries rather than duplicating it in clients. Changes to library APIs can affect CLI, web and VS Code consumers; check those paths together.

## Tooling and builds

- Use the Node version in `.nvmrc` and pnpm version pinned in the root `package.json`. Use `pnpm install --frozen-lockfile` for an existing checkout. Keep `pnpm-lock.yaml` as the workspace lockfile.
- Use `workspace:` dependencies between local packages. Preserve published package names, entry points and supported ESM/CommonJS formats unless the task calls for an API change.
- Reuse the root ESLint, Prettier and TypeScript configurations. Package TypeScript configs extend `tsconfig.base.json`; project-reference builds additionally use `tsconfig.project.json`. Follow the affected package's import-extension convention.
- Libraries use tsdown and `tsdown.base.mts`. Existing editor bundles use esbuild where configured; the web app uses Vite. These differences are intentional.
- Edit source/configuration, not generated `dist`, `out`, `.tsbuild` or `.staging` content. Dependencies often resolve built library output: rebuild a changed library before testing its consumers.
- Keep Husky and VS Code launch/task configuration at the root. Open the root workspace to debug a component; counter extension debugging uses a generated staging directory.

## Verification

Start with the affected package's checks, then validate consumers for shared-library changes:

```sh
pnpm --filter m68k-parser build
pnpm --filter 68kcounter test
pnpm --filter 68kcounter-web test
pnpm --filter 68kcounter-web build
pnpm check
```

`pnpm check` runs workspace builds, lint, formatting, typechecks, tests, linter coverage and the rule-impact audit. The root pre-commit hook runs this too. Do not bypass the hook to conceal a failure. For documentation-only changes, formatting/link review is sufficient outside the commit hook.

- Add focused regression tests for changed behaviour, especially parser locations, instruction encodings, timing arithmetic and fixes applied to source. Avoid tests that only restate implementation details.
- Most unit tests use Vitest. Keep existing transport and VS Code integration runners for their respective suites.
- `pnpm check:vasm` compares sizes, lint suggestions and line syntax with a real vasm binary (`VASM=/path/to/vasmm68k_mot`, after building). It is optional and skips itself without one; see `scripts/vasm/README.md`. Use it when changing instruction sizes, replacement text or parsing.
- After changing published exports or package contents, build and run `pnpm check:packages` to test isolated npm archives.
- `pnpm package` builds and packages all three extensions; `pnpm package:assembly`, `pnpm package:lint` and `pnpm package:counter` package individual extensions after building. Packaging does not publish.
- `pnpm test:extension-host` runs the counter's VS Code host tests and needs a display or Xvfb on Linux. Report whether verification used unit tests, staging or an actual extension host; they are different checks.

## Assembly semantics and timing

- Match vasm expression precedence and dialect behaviour. Reuse the shared expression evaluator; do not introduce JavaScript `eval` for assembly expressions.
- The parser is not a complete instruction-validity checker. Preserve source ranges and distinguish unknown expressions/macros from definitely invalid instructions. Do not treat unknown values as zero.
- Validate encoding changes against vasm where available. Distinguish explicit size suffixes from widths inferred from values, and assembler optimisations from the source instruction's encoding.
- Derive timing changes from the relevant processor manual. Record the manual section and assumptions beside tables or tests. Do not borrow another CPU's timings for unsupported forms.
- Keep CPU clocks, operand accesses and external bus transfers distinct. 68020/68030 use a different timing-vector shape from 68000 and the cached 040/060 references.
- 040 stage timings overlap; EA-stage time is not simply added to execution time. 060 instruction reference costs do not predict pairing or dependencies between instructions. Preserve additive base/EA components where the tables provide them.
- Keep unsupported timing coverage visible and separate mixed timing models in totals. Generic assumptions belong in summaries; per-instruction expansions should explain actual costs, alternatives or instruction-specific notes.
- Linter optimisations must account for register/flag effects and safety conditions. Preserve meaningful tradeoffs while avoiding redundant suggestions. Conditional or unsafe fixes can be offered explicitly to the user without entering automatic fix-all operations.

## Changes and releases

- Inspect `git status` before editing or committing. Preserve unrelated user changes and stage only the requested work. Do not commit or publish unless requested.
- Add a `.changeset/*.md` file for user-facing package changes, naming affected packages and appropriate semver bumps. Packages are independently versioned; use Changesets rather than manually bumping versions or running `npm version`.
- The VS Code extensions are private packages that bundle the servers, so a new server version does not bump them: Changesets only bumps a dependent when the dependency leaves its range, and the extensions hold them as dev dependencies or within a caret range. Add a changeset naming the extension (`m68k-lsp`, `m68k-lint-vscode`, `68kcounter-vscode`) whenever a release should ship a new version of it; otherwise the Marketplace publish finds its version already taken.
- Changesets versioning generates package changelog entries and updates internal dependency ranges. Keep release notes with the owning package and update relevant client documentation when behaviour changes.
- Preserve package licence files, copyright notices and bundled third-party licences.
- Summarise what changed, what was verified and any remaining limitations. Keep these instructions durable: do not add temporary task status, machine-specific paths or transient test counts.
