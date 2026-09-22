---
"m68k-lint": minor
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

A rule can now report a finding alongside `alternatives`: other complete, independently applicable replacements for the same span, typically a cheaper one that depends on something only the developer can confirm. Each alternative gets the same treatment as the primary suggestion (span, symbol-loss note, obfuscation annotation, measured 68000 impact) and shows up as its own labeled quick fix in the editor and the CLI's interactive review, rather than as prose in a note.

`divu-word-by-constant` is the first rule converted: alongside its widest reciprocal-multiply suggestion, it now offers each cheaper, narrower-range scale as a selectable alternative instead of describing them only in a note.

The editor's display of a diagnostic with several alternatives is cleaned up to match: the "disable this rule" quick fixes are offered once per distinct rule among the choices (not once per choice), and each choice's notes are numbered ("Option 1 of 3 -- ...") and shown once instead of repeating a caveat worded identically across every choice.

An alternative does not always come from the rule offering it. `mulu-word-power-of-two`, `muls-word-power-of-two` and their high-power siblings replace a word multiply by a power of two with a sign/zero-extend-then-shift sequence that is always correct; `mulu-word-low-word-only`/`muls-word-low-word-only` know a plain word shift does the same job for less whenever the old upper word of the result is not read. Rather than one silently deferring to the other (which was the previous behaviour, hiding whichever option was not picked), the power-of-two rules now compute and attach the word-only form as a cheaper, conditional alternative -- so the reader sees both, and can disable either independently.
