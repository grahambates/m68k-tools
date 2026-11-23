# ORI to CCR - Inclusive OR immediate to condition code register

## Operation
[CCR] ← \<literal\> + [CCR]

## Syntax
```assembly
ORI[.b] #<data>,CCR
```

## Description
OR the immediate data with the condition code register (i.e., the least-significant byte of the status register).

## Application
Used to set bits in the CCR. For example, the Z flag of the CCR can be set by `ORI #$04,CCR`.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|*|*|*|*|*|

X:= set if bit 4 of data = 1; unchanged otherwise<br/>
N:= set if bit 3 of data = 1; unchanged otherwise<br/>
Z:= set if bit 2 of data = 1; unchanged otherwise<br/>
V:= set if bit 1 of data = 1; unchanged otherwise<br/>
C:= set if bit 0 of data = 1; unchanged otherwise

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*
