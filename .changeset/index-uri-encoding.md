---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Index workspace files under the same URIs the editor and include resolution use. Files under paths containing characters such as spaces, parentheses or `@` are no longer indexed twice, which duplicated their references and symbols.
