/**
 * Calibration for the differential checker.
 *
 * s68k describes itself as a teaching tool and says plainly: "It wasn't made to
 * assemble or make actual programs, but merely as a learning tool, don't expect
 * 100% accuracy." That is disqualifying for an oracle, so it is not treated as
 * one. When the checker reports a disagreement it says a rule and an
 * interpreter disagree, not that the rule is wrong.
 *
 * This file establishes how far the interpreter can be trusted, by running
 * behaviour whose 68000 result is documented and checking it agrees. Cases are
 * chosen for the semantics the rules actually depend on: which instructions
 * touch X, what the word multiply and divide forms do with the halves of a
 * register, and the shift and extension edges.
 *
 * Every expectation here is from the 68000 programmer's reference, and where
 * timing-adjacent, cross-checked against sources/yacht.txt.
 */

/** X, in particular, is the flag the rules reason about most and the easiest to get wrong. */
export const CONFORMANCE = [
  // --- MOVEQ and the basic flag set ---
  {
    name: "moveq #0 sets Z, clears N V C",
    code: ["moveq #0,d0"],
    d0: 0x00000000,
    flags: "Z",
  },
  {
    name: "moveq #-1 sets N",
    code: ["moveq #-1,d0"],
    d0: 0xffffffff,
    flags: "N",
  },
  // Written as #$80 first time round, which the interpreter rejects as out of
  // range, exactly as vasm warns. -128 is the same value spelled honestly.
  {
    name: "moveq sign-extends its byte",
    code: ["moveq #-128,d0"],
    d0: 0xffffff80,
    flags: "N",
  },

  // --- X is written by arithmetic and preserved by data movement ---
  {
    name: "addq carry out sets X and C",
    code: ["moveq #-1,d0", "addq.l #1,d0"],
    d0: 0,
    flags: "XZC",
  },
  {
    name: "move does not disturb X",
    code: ["moveq #-1,d0", "addq.l #1,d0", "move.l #5,d1"],
    d0: 0,
    flags: "X",
  },
  // Compared against #0 so the comparison itself sets no carry, leaving X the
  // only interesting flag. An earlier version compared against #1, whose borrow
  // set C and made the case about two things at once.
  {
    name: "cmp does not disturb X",
    code: ["moveq #-1,d0", "addq.l #1,d0", "moveq #0,d1", "cmp.l #0,d1"],
    d0: 0,
    flags: "XZ",
  },
  {
    name: "movea sets no flags at all",
    code: ["moveq #0,d0", "tst.l d0", "movea.l #-1,a0"],
    d0: 0,
    flags: "Z",
  },
  {
    name: "lea sets no flags at all",
    code: ["moveq #0,d0", "tst.l d0", "lea $2000,a0"],
    d0: 0,
    flags: "Z",
  },
  // An assembler picks ADDA/SUBA whenever the destination is an address
  // register, and neither writes a condition code. Worth pinning: the checker
  // rewrites plain ADD/SUB on address registers into these, because the
  // interpreter otherwise runs the data form and invents flags.
  {
    name: "adda sets no flags at all",
    code: ["moveq #0,d0", "tst.l d0", "adda.w #-16,sp"],
    d0: 0,
    flags: "Z",
  },
  {
    name: "suba sets no flags at all",
    code: ["moveq #0,d0", "tst.l d0", "suba.l #4,a0"],
    d0: 0,
    flags: "Z",
  },
  // CMPA is the exception among the address forms: it writes no register, and
  // sets N, Z, V and C from the subtraction exactly as CMP does.
  {
    name: "cmpa sets Z when equal",
    code: ["moveq #0,d0", "movea.l #$2000,a0", "cmpa.l #$2000,a0"],
    d0: 0,
    flags: "Z",
  },
  {
    name: "cmpa sets N when less",
    code: ["moveq #0,d0", "movea.l #$1000,a0", "cmpa.l #$2000,a0"],
    d0: 0,
    flags: "NC",
  },
  // MOVEA.W is not a narrow write: it sign-extends through the whole register.
  {
    name: "movea.w sign-extends into the long",
    code: ["movea.w #-1,a0", "move.l a0,d0"],
    d0: 0xffffffff,
    flags: "N",
  },

  // --- overflow and sign ---
  {
    name: "add overflowing into the sign sets V",
    code: ["move.l #$7FFFFFFF,d0", "addq.l #1,d0"],
    d0: 0x80000000,
    flags: "NV",
  },
  {
    name: "sub to zero sets Z, clears X and C",
    code: ["moveq #5,d0", "subq.l #5,d0"],
    d0: 0,
    flags: "Z",
  },
  {
    name: "neg of zero clears C and X",
    code: ["moveq #0,d0", "neg.l d0"],
    d0: 0,
    flags: "Z",
  },
  {
    name: "neg of non-zero sets C and X",
    code: ["moveq #1,d0", "neg.l d0"],
    d0: 0xffffffff,
    flags: "XNC",
  },

  // --- shifts, where the bit shifted out lands in both X and C ---
  {
    name: "lsl out of the top sets X and C",
    code: ["move.l #$80000000,d0", "lsl.l #1,d0"],
    d0: 0,
    flags: "XZC",
  },
  {
    name: "asr keeps the sign bit",
    code: ["move.l #$80000000,d0", "asr.l #1,d0"],
    d0: 0xc0000000,
    flags: "N",
  },
  {
    name: "lsr shifts a zero in at the top",
    code: ["move.l #$80000000,d0", "lsr.l #1,d0"],
    d0: 0x40000000,
    flags: "",
  },
  {
    name: "rol wraps rather than dropping the bit",
    code: ["move.l #$80000000,d0", "rol.l #1,d0"],
    d0: 0x00000001,
    flags: "C",
  },

  // --- extension and halves ---
  {
    name: "ext.l sign-extends the word",
    code: ["move.l #$0000FFFF,d0", "ext.l d0"],
    d0: 0xffffffff,
    flags: "N",
  },
  {
    name: "ext.w sign-extends the byte only",
    code: ["move.l #$00000080,d0", "ext.w d0"],
    d0: 0x0000ff80,
    flags: "N",
  },
  {
    name: "swap exchanges the halves",
    code: ["move.l #$12345678,d0", "swap d0"],
    d0: 0x56781234,
    flags: "",
  },
  {
    name: "not inverts every bit",
    code: ["moveq #0,d0", "not.l d0"],
    d0: 0xffffffff,
    flags: "N",
  },

  // --- word multiply reads only the low half ---
  {
    name: "muls.w ignores the high word",
    code: ["move.l #$00010000,d0", "muls #2,d0"],
    d0: 0,
    flags: "Z",
  },
  {
    name: "muls.w treats the low word as signed",
    code: ["move.l #$0000FFFF,d0", "muls #2,d0"],
    d0: 0xfffffffe,
    flags: "N",
  },
  {
    name: "mulu.w treats the low word as unsigned",
    code: ["move.l #$0000FFFF,d0", "mulu #2,d0"],
    d0: 0x0001fffe,
    flags: "",
  },

  // --- divide packs remainder above quotient ---
  {
    name: "divu packs remainder:quotient",
    code: ["move.l #13,d0", "divu #4,d0"],
    d0: 0x00010003,
    flags: "",
  },

  // --- byte-wide writes leave the rest of the register alone ---
  {
    name: "st writes only the low byte",
    code: ["move.l #$12345678,d0", "st d0"],
    d0: 0x123456ff,
    flags: "",
  },
  {
    name: "a byte move preserves the upper bits",
    code: ["move.l #$12345678,d0", "move.b #1,d0"],
    d0: 0x12345601,
    flags: "",
  },
];
