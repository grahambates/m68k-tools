# ANDI - AND immediate

## Operation
[destination] ← \<literal\>.[destination]

## Syntax
```assembly
ANDI[.(bwl)] #<data>,<destination>
```

## Description
*AND* the immediate data to the destination operand. The `ANDI` permits a literal operand to be ANDed with a destination other than a data register. For example, `ANDI #$FE00,$1234` or `ANDI.B #$F0,(A2)+`.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|-|*|*|0|0|

## Destination operand addressing modes
|Dn|An|(An)|(An)+|&#x2011;(An)|(d,An)|(d,An,Xi)|ABS.W|ABS.L|(d,PC)|(d,PC,Xn)|imm|
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|✓||✓|✓|✓|✓|✓|✓|✓||||

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*
