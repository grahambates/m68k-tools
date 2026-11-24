---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Show an evaluated value on hover in decimal, hexadecimal, binary and octal and as characters, as a number literal's hover already does, beneath the constant or expression it belongs to. Hexadecimal is written in upper case in both. Values in an address operand (an absolute address such as `custom+intena`, a PC-relative target, or an immediate moved into an address register) are shown in hexadecimal alone, and a constant written in hexadecimal is shown hexadecimal first, as `custom equ $DFF000 (14675968)`. A negative value is shown in the other bases as its 32-bit pattern, and a value whose top byte is `$80` or more no longer loses its first character.
