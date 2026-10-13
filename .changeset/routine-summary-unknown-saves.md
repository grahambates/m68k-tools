---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

A routine's register summary no longer says it may modify any register when code it runs can't be analysed but registers are saved on the stack around that code. It names the registers that could still change, such as `Modifies possibly D0–D1/A0–A1` for a call inside a `d2-d7/a2-a6` save. This includes a branch that can't be resolved, such as a tail call into another file or `jmp (a0)`, in the routine or in a subroutine it calls.

After such a branch, register availability is now unknown rather than unavailable, and a routine's summary says it possibly reads other registers there rather than listing them as read.
