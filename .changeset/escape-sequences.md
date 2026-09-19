---
"m68k-parser": minor
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lsp-server": minor
"68kcounter": minor
---

Know about vasm's `-esc`. `escapeSequences` joins `.m68krc.json` (and `m68k-lint.json`, and `m68k.escapeSequences` in editor settings); an `-esc` among the vasm arguments is read as the option, and the assembly server passes `-esc` to vasm when it is set. With it, a backslash in a string is read as vasm does: `\n \r \t \b \e \f`, `\\ \" \'`, up to three octal digits (`\101`) and `\x` with up to two hex digits are one element each, so string data is shorter than it is written. `m68k-parser` gains `decodeStringEscapes`, and `directiveSize` takes `escapeSequences`; the linter's alignment analysis and 68kcounter's `parse` use it. Sequences checked against vasm's own output; `\a` and `\v` are not supported by it.
