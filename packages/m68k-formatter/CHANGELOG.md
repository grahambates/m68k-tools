# m68k-formatter

## 0.3.0

### Minor Changes

- 5c669b3: Publish a JSON schema for `.m68k-format.json` as `m68k-format.schema.json`, and accept a `$schema` key in the file, which used to be rejected. The VS Code extension bundles the schema; elsewhere reference `https://cdn.jsdelivr.net/npm/m68k-formatter@0/m68k-format.schema.json`.
- a8034b3: Read formatter options from the `format` section of a shared `.m68krc.json` as well as `.m68k-format.json`, so the CLI agrees with the language server. The nearest of each is loaded and merged, the nearer on top (`.m68k-format.json` where both share a directory), as the language server already did; a `.m68krc.json` with no `format` section is passed over. `--config` accepts either. `findConfigs` and `loadConfigs` are added.

### Patch Changes

- Updated dependencies [a8034b3]
- Updated dependencies [84eb9ee]
- Updated dependencies [2483db0]
- Updated dependencies [530995e]
- Updated dependencies [ca3b18b]
- Updated dependencies [530995e]
- Updated dependencies [2daedf1]
- Updated dependencies [530995e]
- Updated dependencies [3d61532]
- Updated dependencies [2daedf1]
  - m68k-parser@2.1.0

## 0.2.0

### Minor Changes

- 79d0e32: Add native ESM entry points and matching TypeScript declarations alongside the existing CommonJS builds. Preserve CommonJS entry points, CLI paths and deep file imports.
- a9c19ea: Add `m68k-format --init` to create a `.m68k-format.json` config file interactively, asking for case, label colons, quote style, operand spacing, indent style, trailing whitespace, final newline and line endings. Only answers that differ from the defaults are written.
- f77f9fc: Require Node.js 22.15.1 or later for Node packages and VS Code 1.101 or later for
  extensions. Builds and releases now come from the shared m68k-tools workspace.
  Existing npm and Marketplace identities are preserved.

### Patch Changes

- Updated dependencies [ade45b3]
- Updated dependencies [0ea9bcc]
- Updated dependencies [555bafb]
- Updated dependencies [f77f9fc]
- Updated dependencies [b86ae11]
  - m68k-parser@2.0.0
