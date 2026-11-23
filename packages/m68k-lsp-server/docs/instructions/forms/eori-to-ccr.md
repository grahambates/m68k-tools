# EORI to CCR - Exclusive OR immediate to condition code register

## Operation
[CCR] ← \<literal\> ⊕ [CCR]

## Syntax
```assembly
EORI[.b] #<data>,CCR
```

## Description
EOR the immediate data with the contents of the condition code register (i.e., the least-significant byte of the status register).

## Application
Used to toggle bits in the CCR. For example, `EORI #$0C,CCR` toggles the N- and Z-bits of the CCR.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|*|*|*|*|*|

X:= toggled if bit 4 of data = 1; unchanged otherwise<br/>
N:= toggled if bit 3 of data = 1; unchanged otherwise<br/>
Z:= toggled if bit 2 of data = 1; unchanged otherwise<br/>
V:= toggled if bit 1 of data = 1; unchanged otherwise<br/>
C:= toggled if bit 0 of data = 1; unchanged otherwise

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*
