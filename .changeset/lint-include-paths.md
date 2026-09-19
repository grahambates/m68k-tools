---
"m68k-lint": minor
---

Add `includePaths` to the project config: the directories the assembler is given to find includes in (`vasm -I`), absolute or relative to the config file, and the same setting the assembly language server has. The linter follows each `include` it finds, beside the including file and then through those paths in order, and through what those files include, and reads what it reaches for the constants and macros it defines and the names it refers to, without ever linting it. This lets a project use includes that live outside it, such as NDK files shared between projects, whose location is given to the assembler and appears nowhere in the source. Case is left to the file system, as it would be for the assembler run there. An include that names its own way, such as `../shared/hw.i`, is followed with no configuration. Following is capped at 4000 files.
