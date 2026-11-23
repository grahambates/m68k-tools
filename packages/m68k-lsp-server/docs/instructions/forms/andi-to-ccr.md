# ANDI to CCR - AND immediate to condition code register

## Operation
[CCR] ← \<data\>.[CCR]

## Syntax
```assembly
ANDI[.b] #<data>,CCR
```

## Description
*AND* the immediate data to the condition code register (i.e., the least-significant byte of the status register).

## Application
`ANDI` is used to clear selected bits of the `CCR`. For example, `ANDI #$FA,CCR` clears the Z- and C-bits, i.e., XNZVC = X N 0 V 0.

## Condition codes
|X|N|Z|V|C|
|--|--|--|--|--|
|*|*|*|*|*|

X:= cleared if bit 4 of data = 0; unchanged otherwise<br/>
N:= cleared if bit 3 of data = 0; unchanged otherwise<br/>
Z:= cleared if bit 2 of data = 0; unchanged otherwise<br/>
V:= cleared if bit 1 of data = 0; unchanged otherwise<br/>
C:= cleared if bit 0 of data = 0; unchanged otherwise

*From MOTOROLA M68000 FAMILY Programmer's reference manual. Copyright 1992 by Motorola Inc./NXP. Adapted with permission.*
