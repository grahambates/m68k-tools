---
"m68k-lint": minor
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

A rule can now report a finding alongside `alternatives`: other complete, independently applicable replacements for the same span, typically a cheaper one that depends on something only the developer can confirm. Each alternative gets the same treatment as the primary suggestion (span, symbol-loss note, obfuscation annotation, measured 68000 impact) and shows up as its own labeled quick fix in the editor and the CLI's interactive review, rather than as prose in a note.

`divu-word-by-constant` is the first rule converted: alongside its widest reciprocal-multiply suggestion, it now offers each cheaper, narrower-range scale as a selectable alternative instead of describing them only in a note.

The editor's display of a diagnostic with several alternatives is cleaned up to match: the "disable this rule" quick fixes are offered once per distinct rule among the choices (not once per choice), and each choice's notes are numbered ("Option 1 of 3 -- ...") and shown once instead of repeating a caveat worded identically across every choice.

An alternative does not always come from the rule offering it. `mulu-word-power-of-two`, `muls-word-power-of-two` and their high-power siblings replace a word multiply by a power of two with a sign/zero-extend-then-shift sequence that is always correct; `mulu-word-low-word-only`/`muls-word-low-word-only` know a plain word shift does the same job for less whenever the old upper word of the result is not read. Rather than one silently deferring to the other (which was the previous behaviour, hiding whichever option was not picked), the power-of-two rules now compute and attach the word-only form as a cheaper, conditional alternative -- so the reader sees both, and can disable either independently.

Beyond that one deliberately wired pair, two _independently_ firing rules can now also end up as alternatives for each other automatically, wherever they land on the same source lines. Previously that comparison only ran between rewrites that were both proven safe; a rewrite that only applies conditionally (most of what this release adds) never took part, so two rules matching the same instruction could show as two separate, stacked diagnostics. Now: a rewrite that is safe, has no caveats and costs no more on every measured axis than another candidate drops the worse one outright, exactly as before; anything short of that -- a genuine size/speed trade-off, or a conditional rewrite that only sometimes has the information to apply -- is kept and offered as a listed alternative instead, ranked with the safest, most certain option leading. A handful of existing rule pairs (for example `muls-word-selected-constants` against the generated `muls-word-low-word-only`, or `move-immediate-byte-complement` against `move-immediate-double-byte`) are grouped for the first time as a result; each is a genuine choice between techniques, not a regression.
