---
"m68k-lint": patch
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

Fixed a false positive in `suspicious/unreachable-code`: a single-arm conditional assembly block (`ifne`/`endc`, no `else`) whose condition resolves false at lint time — a build-time feature flag turned off, say — had its contents wrongly checked for reachability. vasm never assembles that arm at all, so a branch and its target inside it, which are perfectly reachable if the flag were on, were flagged as unreachable code. An arm known not to be assembled is now treated the same as a macro body: not code at this point in the file, so nothing inside it is a candidate for this rule. An arm whose condition cannot be resolved, or that is known to be assembled, is unaffected.
