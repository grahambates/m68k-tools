---
"m68k-lint": minor
---

Export what an editor needs to work with a project's ignore list from `m68k-lint/project-config`: `isIgnored` and `alwaysIgnored` decide whether a path is left out of linting, `configIgnores` reads the list under either of its names, and `addIgnoreToConfigText` and `newConfigText` add a file to a config's `ignores`. The edit is made as text, placing the entry beside the existing ones in the same style and leaving the rest of the file alone, and declines rather than clobbers a config it cannot place an entry in.
