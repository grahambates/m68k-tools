# m68k-formatter

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
