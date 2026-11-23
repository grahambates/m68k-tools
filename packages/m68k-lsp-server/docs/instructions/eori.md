# EORI - Exclusive OR immediate

## Operation
[destination] ← \<literal\> ⊕ [destination]
[CCR] ← \<literal\> ⊕ [CCR]
IF [S] = 1<br/>&nbsp;&nbsp;THEN<br/>&nbsp;&nbsp;&nbsp;&nbsp;[SR] ← \<literal\> ⊕ [SR]<br/>&nbsp;&nbsp;ELSE TRAP

## Syntax
```assembly
EORI[.(bwl)] #<data>,<destination>
EORI[.b] #<data>,CCR
EORI[.w] #<data>,SR
```

## Attributes
`Size` byte, word, longword

## Description
EOR the immediate data with the contents of the destination operand. Store the result in the destination operand.

** EORI to CCR - Exclusive OR immediate to condition code register **

EOR the immediate data with the contents of the condition code register (i.e., the least-significant byte of the status register). Used to toggle bits in the CCR. For example, `EORI #$0C,CCR` toggles the N- and Z-bits of the CCR.

** EORI to SR - Exclusive OR immediate to status register **

EOR (exclusive OR) the immediate data with the contents of the status register and store the result in the status register. All bits of the status register are affected.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|-|*|*|0|0|

## Destination operand addressing modes
|Dn|An|(An)|(An)+|&#x2011;(An)|(d,An)|(d,An,Xi)|ABS.W|ABS.L|(d,PC)|(d,PC,Xn)|imm|
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|✓||✓|✓|✓|✓|✓|✓|✓||||

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*