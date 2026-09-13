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
Marketplace publication and Vercel cutover are separate
steps. In particular the formatter and lint language server have not yet been
published. No generic publish command is wired into CI.
