Foo	equ	1
foo	equ	2
start:
	move.l	#Foo,d0
	move.l	#foo,d1
	rts
