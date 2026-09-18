---
"m68k-lint": minor
---

Add `suspicious/unused-macro`, flagging a macro that nothing in the project invokes. Off by default and only checked when a project-wide reference index is available, for the same reason as `unused-global-label`: a macro is usually defined in an include file for every source to draw on. Both `NAME: MACRO` and `MACRO NAME` definitions are recognised, invocations match without regard to case, and a call from inside another macro counts as a use. The project reference index gains an `invokes` lookup for macro calls, which are mnemonics rather than operand symbols.
