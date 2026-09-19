---
"m68k-lint": minor
---

Add `suspicious/string-escape-sequence`, which warns about backslash escapes such as `\n` or `\t` in string data (`dc.b "Hello\n",0`). vasm only interprets escape sequences when given `-esc`; otherwise the backslash and letter are two characters of data, so the string assembles without complaint and the wrong bytes are emitted. The finding suggests writing the value as its own element (`dc.b "Hello",10,0`). Macro bodies are not checked, since a backslash there starts a parameter. Set `escapeSequences: true` for a project assembled with `-esc`, which turns it off.
