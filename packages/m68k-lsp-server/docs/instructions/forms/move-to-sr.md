# MOVE to SR - Copy data to SR from source

## Operation
IF [S] = 1<br/>&nbsp;&nbsp;THEN [SR] ← [source]<br/>ELSE TRAP

## Syntax
```assembly
MOVE[.w] <source>,SR
```

## Description
Move the contents of the source operand to the status register. The source operand is a word and all bits of the status register are affected. This is a privileged instruction.

## Application
The `MOVE to SR` instruction allows the programmer to preset the contents of the status register. This instruction permits the trace mode, interrupt mask, and status bits to be modified. For example, `MOVE #$2700,SR` moves 00100111 00000000 to the status register which clears all bits of the CCR, sets the S-bit, clears the T-bit, and sets the interrupt mask level to 7.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|*|*|*|*|*|

Set according to the source operand: X from bit 4, N from bit 3, Z from bit 2, V from bit 1 and C from bit 0.

## Source operand addressing modes
|Dn|An|(An)|(An)+|&#x2011;(An)|(d,An)|(d,An,Xi)|ABS.W|ABS.L|(d,PC)|(d,PC,Xn)|imm|
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|✓||✓|✓|✓|✓|✓|✓|✓|✓|✓|✓|

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*
