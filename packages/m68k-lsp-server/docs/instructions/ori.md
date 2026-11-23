# ORI - OR immediate

## Operation
[destination] ← \<literal\> + [destination]
[CCR] ← \<literal\> + [CCR]
IF [S] = 1<br/>&nbsp;&nbsp;THEN<br/>&nbsp;&nbsp;&nbsp;&nbsp;[SR] ← \<literal\> + [SR]<br/>&nbsp;&nbsp;ELSE TRAP

## Syntax
```assembly
ORI[.(bwl)] #<data>,<destination>
ORI[.b] #<data>,CCR
ORI[.w] #<data>,SR
```

## Attributes
`Size`  byte, word, longword

## Description
OR the immediate data with the destination operand. Store the result in the destination operand.

** ORI to CCR - Inclusive OR immediate to CCR **

OR the immediate data with the condition code register (i.e., the least-significant byte of the status register). For example, the Z flag of the CCR can be set by `ORI #$04,CCR`.

** ORI to SR - Inclusive OR immediate to status register **
OR the immediate data to the status register and store the result in the status register. All bits of the status register are affected.

Used to set bits in the SR (i.e., the S, T, and interrupt mask bits). For example, `ORI #$8000,SR` sets bit 15 of the SR (i.e., the trace bit).

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|-|*|*|0|0|

## Application
`ORI` forms the logical OR of the immediate source with the effective address, which may be a memory location. For example,

```
ORI.B #%00000011,(A0)+
```

## Destination operand addressing modes
|Dn|An|(An)|(An)+|&#x2011;(An)|(d,An)|(d,An,Xi)|ABS.W|ABS.L|(d,PC)|(d,PC,Xn)|imm|
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|✓||✓|✓|✓|✓|✓|✓|✓||||

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*