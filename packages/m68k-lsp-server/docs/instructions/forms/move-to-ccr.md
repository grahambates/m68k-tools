# MOVE to CCR - Copy data to CCR from source

## Operation
[CCR] ← [source]

## Syntax
```assembly
MOVE[.w] <source>,CCR
```

## Description
Move the contents of the source operand to the condition code register. The source operand is a *word*, but only the low-order *byte* contains the condition codes. The upper byte is neglected. Note that `MOVE <source>,CCR` is a word operation, but `ANDI`, `ORI`, and `EORI` to `CCR` are all byte operations.

## Application
The move to CCR instruction permits the programmer to preset the CCR. For example, `MOVE #0,CCR` clears all the CCR's bits.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|*|*|*|*|*|

X:= set to bit 4 of the source operand<br/>
N:= set to bit 3 of the source operand<br/>
Z:= set to bit 2 of the source operand<br/>
V:= set to bit 1 of the source operand<br/>
C:= set to bit 0 of the source operand

## Source operand addressing modes
|Dn|An|(An)|(An)+|&#x2011;(An)|(d,An)|(d,An,Xi)|ABS.W|ABS.L|(d,PC)|(d,PC,Xn)|imm|
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|✓||✓|✓|✓|✓|✓|✓|✓|✓|✓|✓|

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*
