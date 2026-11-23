# ANDI to SR - AND immediate to status register

## Operation
IF [S] = 1<br/>&nbsp;&nbsp;THEN [SR] ← \<literal\>.[SR]<br/>ELSE TRAP

## Syntax
```assembly
ANDI[.w] #<data>,SR
```

## Description
*AND* the immediate data to the status register and store the result in the status register. All bits of the SR are affected. This is a privileged instruction.

## Application
This instruction is used to clear the interrupt mask, the S-bit, and the T-bit of the *SR*. `ANDI #<data>,SR` affects both the status byte of the *SR* and the *CCR*. For example, `ANDI #$7FFF,SR` clears the trace bit of the status register, while `ANDI #$7FFE,SR` clears the trace bit and also clears the carry bit of the *CCR*.

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
