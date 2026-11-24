---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Document Amiga OS library calls on hover. An offset symbol from the includes, such as `_LVOOpenLibrary` in `jsr _LVOOpenLibrary(a6)`, in either case, shows its library, offset, a prototype giving each argument's register, where the result comes back, and links to its page in the Autodocs. A function's bare name in a macro whose name starts with "call", such as `CALLEXEC Forbid`, is read the same way. Nothing is shown where the project defines the symbol with a different value.
