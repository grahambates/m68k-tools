Draw:
	movem.l	d0-d3,-(sp)
	moveq	#1,d0
	movem.l	(sp)+,d0-d3
	rts
