---
"m68k-lint": minor
---

Add `suspicious/unreachable-code`, flagging instructions that nothing can branch to or fall into, usually left behind after an edit. Deliberately conservative: code under a global label, under a referenced local label, straight after a computed jump (an inline jump table) or after a macro invocation is never reported. An unreferenced local label on unreachable code is reported once, as unreachable, rather than also as `unused-local-label` (unless the new rule is turned off).
