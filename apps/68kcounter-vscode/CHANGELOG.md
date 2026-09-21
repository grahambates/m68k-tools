# Change Log

## 1.4.0

### Minor Changes

- Release with counter 5.1: expressions are 32-bit signed as in vasm, string sizes follow vasm (`dc.w "ab"` is one word, and `-esc` escapes are one byte), constants assigned in conditional blocks are unknown when the arms differ, `iif` statements are counted, and `trap` is two bytes.

## 1.3.0

### Minor Changes

- ade45b3: Add 68030 instruction-cache and average no-cache timing estimates from Motorola's manual, preserving reads/prefetches/writes. Support CPU selection through library options, CLI, machine directives and extension defaults. Share cached-CPU lookup construction with 68020 while retaining separate timing data. Resolve full-format and pre/post-indexed memory-indirect timing costs from displacement sizes, including MOVE destinations. Preserve PC bases in parsed memory-indirect operands. Leave unresolved encodings untimed and document estimation assumptions. Label the extension's non-cached mode Uncached; the existing worst configuration value remains compatible.
- 4c6cdec: Add initial cached integer reference costs for the 68040 and 68060, selected through CPU options, source directives and extension defaults. Preserve 68040 execution lead/base and address-calculation data, and expose 68060 branch-prediction alternatives. Label operand accesses separately from external bus transfers, keep different timing models separate in displayed totals, and flag missing timing coverage. These reference sums do not model sequence overlap or 68060 pairing; no uncached model is provided for these CPUs.
- ade45b3: Use the workspace counter library to support 68020 timings, including all three bus-cycle columns. Add resource-scoped default CPU and cache timing settings, temporary per-document cache-mode toggles with reset-to-default, and live configuration updates. Count selections in document context so preceding CPU directives and symbol assignments are respected.
- f77f9fc: Require Node.js 22.15.1 or later for Node packages and VS Code 1.101 or later for
  extensions. Builds and releases now come from the shared m68k-tools workspace.
  Existing npm and Marketplace identities are preserved.

### Patch Changes

- Updated dependencies [ade45b3]
- Updated dependencies [4c6cdec]
- Updated dependencies [00b35e5]
- Updated dependencies [9527976]
- Updated dependencies [79d0e32]
- Updated dependencies [0ea9bcc]
- Updated dependencies [f77f9fc]
- Updated dependencies [b86ae11]
- Updated dependencies [0ea9bcc]
  - 68kcounter@5.0.0

All notable changes to the "68k-counter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [1.1.2] - 2021-07-05

### Fixed

- Remove 'after' decorator which was affecting cursor position

## [1.1.1] - 2021-06-30

### Fixed

- Debounce updates for improved performance
- Handle single quoted strings

## [1.1.0] - 2021-06-30

### Added

- Calculation tooltips
- Macro and repeat processing
- Improved variable and expression interpreting
- Block byte counts

### Changed

- Sizes now in bytes, not words

### Fixed

- #1 Performance issue toggling timings
- #2 Issues switching between editors
- Inaccurate timings and missing instructions https://github.com/grahambates/68kcounter/issues/2

## [1.0.0] - 2021-04-11

- Initial release
