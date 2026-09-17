# Releases

Run `pnpm changeset` alongside a user-facing change. Include downstream servers
and extensions when bundled dependencies change. Separate descriptions can be
recorded in separate files in the same PR.

`pnpm version-packages` consumes pending files into package versions and
changelogs and updates the lockfile. Review and commit those changes before
publishing. Package tags use the workspace package name and version.

VS Code packages are private on npm and publish separately through VSIX files.
The counter extension has workspace name `68kcounter-vscode`; its generated
shipping manifest preserves `gigabates.68kcounter`.

The release workflow currently creates version PRs only. Registry publication,
Marketplace publication and Vercel cutover are separate, manual steps; no
generic publish command is wired into CI.

## Publishing to npm

Log in (`npm login`) with an account that can publish all six public
packages, then run:

```sh
pnpm exec changeset publish
```

This publishes `m68k-parser`, `68kcounter`, `m68k-lint`, `m68k-formatter`,
`m68k-lsp-server` and `m68k-lint-langserver` in dependency order, skips
anything already at that registry version, and tags every versioned package
(including private ones) as `<name>@<version>`. Push afterwards with
`git push --follow-tags`.

## Publishing to the VS Code Marketplace

Requires a `gigabates` Azure DevOps PAT (Marketplace: Manage scope), set up
once via `vsce login gigabates`. Then:

```sh
pnpm run publish:extensions   # all three, or individually:
pnpm run publish:assembly     # m68k-lsp
pnpm run publish:lint         # m68k-lint-vscode
pnpm run publish:counter      # 68kcounter-vscode
```

Each of these runs `pnpm --filter <package> run publish` under the hood.
`publish` is also a built-in pnpm command, so `pnpm --filter <package>
publish` (without `run`) silently runs pnpm's own npm-publish check instead
of the package's script — against a `private: true` package that always
reports "no new packages to publish" and does nothing. Use the `pnpm run
publish:*` scripts above, or `run` explicitly, to avoid that.

The counter extension can't just run `vsce publish` from
`apps/68kcounter-vscode`: its workspace package name (`68kcounter-vscode`)
differs from its Marketplace identity (`gigabates.68kcounter`).
`publish:counter` instead calls `scripts/package-counter-extension.mjs
--publish`, which stages the renamed manifest, builds
`68kcounter-<version>.vsix` at the repository root, and publishes that file
by path.
