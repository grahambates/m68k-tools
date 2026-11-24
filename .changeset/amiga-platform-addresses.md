---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Add a `platform` setting (`m68k.platform` in VS Code): `auto`, the default, `amiga` or `none`. Amiga features that go by standard names stay on everywhere with `auto`; new ones that go by addresses alone are on where the workspace shows signs of Amiga code (its includes, `_LVO` symbols, the custom and CIA base symbols, or a hardware register's address), or where the setting is `amiga`. `none` turns them all off. Each file takes the setting from its nearest `.m68krc.json`, so builds for different machines can each set their own.

Amiga registers given by address are now documented on hover like named ones: `move.w d0,$dff09a`, `btst #6,$bfe001`, and `$96(a6)` after `lea $dff000,a6` or `move.l #CUSTOM,a6` in the same routine. Values moved into them are decoded, and colours moved into colour registers by address, or written as numeric Copper MOVEs in a Copper list (`dc.w $0180,$0f80`), get swatches and the colour picker.
