# MOVE USP - Copy data to or from USP

## Operation
IF [S] = 1&nbsp;&nbsp;&nbsp;&nbsp;{MOVE USP,An form}<br/> &nbsp;&nbsp;THEN [An] ← [USP]<br/> ELSE TRAP
IF [S] = 1&nbsp;&nbsp;&nbsp;&nbsp;{MOVE An,USP form}<br/> &nbsp;&nbsp;THEN [USP] ← [An]<br/> ELSE TRAP

## Syntax
```assembly
MOVE[.l] USP,An
MOVE[.l] An,USP
```

## Description
Move the contents of the user stack pointer to an address register or vice versa. This is a privileged instruction and allows the operating system running in the supervisor state either to read the contents of the user stack pointer or to set up the user stack pointer.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|-|-|-|-|-|

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*
