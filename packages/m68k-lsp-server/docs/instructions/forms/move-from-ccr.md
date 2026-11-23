# MOVE from CCR - Copy data from CCR to destination

## Operation
[destination] ← [CCR]

## Syntax
```assembly
MOVE[.w] CCR,<destination>
```

## Description
Move the contents of the condition code register, zero-extended to a word, to the destination location. The operand size is a word, and the bits above the condition codes are written as zeros. This instruction is not available on the 68000; it lets user-mode code read the condition codes on later processors, where `MOVE SR,<destination>` is privileged.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|-|-|-|-|-|

## Destination operand addressing modes
|Dn|An|(An)|(An)+|&#x2011;(An)|(d,An)|(d,An,Xi)|ABS.W|ABS.L|(d,PC)|(d,PC,Xn)|imm|
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|✓||✓|✓|✓|✓|✓|✓|✓||||

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*
