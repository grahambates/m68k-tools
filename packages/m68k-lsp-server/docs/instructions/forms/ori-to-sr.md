# ORI to SR - Inclusive OR immediate to status register

## Operation
IF [S] = 1<br/>&nbsp;&nbsp;THEN [SR] ← \<literal\> + [SR]<br/>ELSE TRAP

## Syntax
```assembly
ORI[.w] #<data>,SR
```

## Description
OR the immediate data to the status register and store the result in the status register. All bits of the status register are affected. This is a privileged instruction.

## Application
Used to set bits in the SR (i.e., the S, T, and interrupt mask bits). For example, `ORI #$8000,SR` sets bit 15 of the SR (i.e., the trace bit).

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
