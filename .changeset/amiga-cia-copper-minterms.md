---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Document more Amiga hardware on hover. CIA registers and flags named as `hardware/cia.i` names them, such as `ciaa+ciapra`, `ciaicr(a0)`, `_ciab` and `CIAB_GAMEPORT0`, are described for the chip the operand names, or for both where it does not say; the bit a `btst`, `bset`, `bclr` or `bchg` tests or changes in a named CIA register is described, so `btst #6,ciaa` shows the left mouse button; and bytes moved into one are decoded. In copper lists, recognised by a register-named MOVE, the usual `$FFFF,$FFFE` end or a label naming them, WAIT and SKIP instructions are described with their beam position, masks and blitter wait, and MOVEs written as numbers, such as `dc.w $0180,$0f80`, are read as writes to the register they name. Blitter logic functions written to BLTCON0 or BLTCON0L are shown as equations, such as `$CA (D = AB + ¬AC, cookie-cut)`.
