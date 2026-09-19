import type { LintConfig } from "../core/config.js";
import { fixtureContext, ids, lint, parseFixture } from "./helpers.js";

// Fixtures that need "all changed flags are dead" end with `add.l dX,dY` rather
// than `move.l dX,dY`. MOVE sets N/Z and clears V/C but *preserves X*, so with a
// MOVE the X flag still escapes through the trailing RTS and rules correctly
// downgrade their suggestion to "conditional". ADD writes X too, which is what
// these tests actually mean by "dead".

describe("diagnostic ordering", () => {
  test("diagnostics are returned in source order, not rule-registration order", () => {
    const source = [
      "start:",
      "move.l 0(a0),d0", // line 2
      "move.l #42,d3", // line 3
      "add.l #1,d0", // line 4
      "lea (a0),a0", // line 5
    ].join("\n");
    const lineNumbers = lint(source).map((d) => d.loc.line);
    expect(lineNumbers.length).toBeGreaterThan(1);
    expect([...lineNumbers].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      lineNumbers,
    );
  });
});

describe("optimization rules", () => {
  test("prefers MOVEQ for signed 8-bit long immediates", () => {
    expect(ids("move.l #42,d3")).toContain("optimization/prefer-moveq");
    expect(ids("move.l #-128,d7")).toContain("optimization/prefer-moveq");
    expect(ids("move.l #128,d0")).not.toContain("optimization/prefer-moveq");
    expect(ids("move.w #1,d0")).not.toContain("optimization/prefer-moveq");
  });

  test("a character constant followed by an operator is its value, not the string", () => {
    // 'A'+1 is 66, which fits MOVEQ; read as the string "A'+1" it would not.
    expect(
      lint("move.l #'A'+1,d5").find(
        (d) => d.ruleId === "optimization/prefer-moveq",
      )?.suggestion?.replacement,
    ).toBe("\tmoveq #'A'+1,d5");
  });

  test("prefers MOVEQ for a character constant, keeping it as written", () => {
    const replacement = (source: string) =>
      lint(source).find((d) => d.ruleId === "optimization/prefer-moveq")
        ?.suggestion?.replacement;
    expect(replacement("move.l #'A',d5")).toBe("\tmoveq #'A',d5");
    // The blank inside the quotes is a character, not spacing to tidy away.
    expect(replacement("move.l #' ',d5")).toBe("\tmoveq #' ',d5");
    // Four characters do not fit a signed byte.
    expect(ids("move.l #'AB',d5")).not.toContain("optimization/prefer-moveq");
  });

  test("LEA for MOVEA.W gives an unsigned word address as the negative one it loads", () => {
    const replacement = (source: string) =>
      lint(source).find(
        (d) => d.ruleId === "optimization/movea-immediate-to-lea",
      )?.suggestion?.replacement;
    // vasm rejects `lea $8000.w`; `lea -32768.w` is the $FFFF8000 MOVEA.W loads.
    expect(replacement("movea.w #$8000,a0")).toBe("\tlea -32768.w,a0");
    expect(replacement("movea.w #$ffff,a0")).toBe("\tlea -1.w,a0");
    expect(replacement("movea.w #$7fff,a0")).toBe("\tlea $7fff.w,a0");
  });

  test("prefers MOVEQ for negative immediates written as unsigned longs", () => {
    const diagnostic = lint("move.l #$ffffff80,d5").find(
      (d) => d.ruleId === "optimization/prefer-moveq",
    );
    // The unsigned spelling is out of MOVEQ's operand range, so the suggestion
    // has to give the signed form.
    expect(diagnostic?.suggestion?.replacement).toBe("\tmoveq #-128,d5");
    expect(ids("move.l #$ffffff7f,d5")).not.toContain(
      "optimization/prefer-moveq",
    );
    expect(ids("move.l #$7fffffff,d5")).not.toContain(
      "optimization/prefer-moveq",
    );
  });

  test("prefers MOVEQ when an EQU expression resolves to the range", () => {
    const source = ["answer equ 40+2", "move.l #answer,d0"].join("\n");

    expect(ids(source)).toContain("optimization/prefer-moveq");
  });

  test("resolves chained EQU constants", () => {
    const source = [
      "base equ 40",
      "answer equ base+2",
      "move.l #answer,d0",
    ].join("\n");

    expect(ids(source)).toContain("optimization/prefer-moveq");
  });

  test("prefers ADDQ for immediates 1..8", () => {
    expect(ids("add.l #1,d0")).toContain("optimization/prefer-addq");
    expect(ids("addi.l #1,d0")).toContain("optimization/prefer-addq");
    expect(ids("add.w #8,(a0)")).toContain("optimization/prefer-addq");
    expect(ids("add.l #9,d0")).not.toContain("optimization/prefer-addq");
    expect(ids("add.b #1,a0")).not.toContain("optimization/prefer-addq");
  });

  test("matches address-register instruction families where rules opt in", () => {
    expect(ids("adda.l #100,a0")).toContain("optimization/address-add-to-lea");
    expect(ids("suba.l #100,a0")).toContain("optimization/address-sub-to-lea");
  });

  test("detects redundant LEA only when registers match", () => {
    expect(ids("lea (a0),a0")).toContain("optimization/redundant-lea");
    expect(ids("lea (a0),a1")).not.toContain("optimization/redundant-lea");
  });

  test("detects redundant LEA written with an explicit zero displacement", () => {
    const diagnostic = lint("lea 0(a3),a3").find(
      (d) => d.ruleId === "optimization/redundant-lea",
    );
    expect(diagnostic?.message).toContain("0(a3)");
    expect(ids("off equ 0\nlea off(a3),a3")).toContain(
      "optimization/redundant-lea",
    );
    expect(ids("lea 4(a3),a3")).not.toContain("optimization/redundant-lea");
  });

  test("detects a null BRA across blank/comment-only lines", () => {
    const source = [
      "bra .next",
      "; comment",
      "",
      ".next:",
      "move.l d0,d1",
    ].join("\n");

    expect(ids(source)).toContain("optimization/null-branch");
  });

  test("does not flag BRA when a statement occurs before the target", () => {
    const source = ["bra .next", "move.l d0,d1", ".next:"].join("\n");

    expect(ids(source)).not.toContain("optimization/null-branch");
  });

  test("uses ADDQ/SUBQ for small same-register LEA displacements", () => {
    const positive = lint("lea 6(a2),a2").find(
      (d) => d.ruleId === "optimization/prefer-lea-quick",
    );
    expect(positive?.suggestion?.replacement).toBe("\taddq.w #6,a2");

    const negative = lint("lea -3(a4),a4").find(
      (d) => d.ruleId === "optimization/prefer-lea-quick",
    );
    expect(negative?.suggestion?.replacement).toBe("\tsubq.w #3,a4");

    expect(ids("lea 6(a2),a3")).not.toContain("optimization/prefer-lea-quick");
    expect(ids("lea 9(a2),a2")).not.toContain("optimization/prefer-lea-quick");
  });

  test("offers the JSR/BSR followed by RTS tail call, conditional on stack depth", () => {
    expect(ids(["jsr helper", "rts"].join("\n"))).toContain(
      "optimization/jsr-rts-tail-call",
    );
    expect(ids(["bsr helper", "rts"].join("\n"))).toContain(
      "optimization/bsr-rts-tail-call",
    );

    const diagnostic = lint(["jsr helper", "rts"].join("\n")).find(
      (d) => d.ruleId === "optimization/jsr-rts-tail-call",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
  });

  test("folds address-register push plus immediate stack adjustment into PEA", () => {
    const source = [
      "move.l a0,-(sp)",
      "add.l #12,(sp)",
      "add.l d1,d2",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/push-address-pea",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tpea 12(a0)");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("PEA folding remains conditional when original arithmetic flags escape", () => {
    const source = ["move.l a1,-(sp)", "sub.l #4,(sp)", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/push-address-pea",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tpea -4(a1)");
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
  });

  test("uses MOVEQ #0 for CLR.L Dn on 68000 targets", () => {
    const diagnostic = lint("clr.l d3").find(
      (d) => d.ruleId === "optimization/prefer-moveq-zero",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tmoveq #0,d3");

    const laterCpu = lint("clr.l d3", { processors: ["mc68040"] });
    expect(laterCpu.map((d) => d.ruleId)).not.toContain(
      "optimization/prefer-moveq-zero",
    );
  });

  test("uses ST for MOVE.B #-1 when CCR differences are dead", () => {
    const source = ["move.b #-1,(a0)", "move.l d0,d1", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/prefer-st-minus-one",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tst (a0)");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("keeps ST conversion conditional when MOVE flags escape", () => {
    const source = ["move.b #-1,d0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/prefer-st-minus-one",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
  });

  test("suggests ADD for a one-bit left shift only on supported target set", () => {
    expect(ids("lsl.w #1,d2")).toContain(
      "optimization/prefer-add-for-shift-one",
    );
    const cpu060 = lint("lsl.w #1,d2", { processors: ["mc68060"] });
    expect(cpu060.map((d) => d.ruleId)).not.toContain(
      "optimization/prefer-add-for-shift-one",
    );
  });

  test("shrinks signed 16-bit immediate loads to address registers", () => {
    const diagnostic = lint("move.l #1234,a2").find(
      (d) => d.ruleId === "optimization/prefer-move-word-address",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tmovea.w #1234,a2");
    expect(ids("move.l #40000,a2")).not.toContain(
      "optimization/prefer-move-word-address",
    );
  });

  test("accepts -32768 as a sign-extending word immediate for address registers", () => {
    // $8000 sign-extends to -32768, the same value a .l load would carry -- the
    // full signed 16-bit range is -32768..32767, not -32767..32767.
    expect(ids("move.l #-32768,a2")).toContain(
      "optimization/prefer-move-word-address",
    );
    expect(ids("move.l #-32769,a2")).not.toContain(
      "optimization/prefer-move-word-address",
    );
  });

  test("zeros an address register with SUBA.L", () => {
    const diagnostic = lint("move.l #0,a3").find(
      (d) => d.ruleId === "optimization/zero-address-register",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tsuba.l a3,a3");
    expect(ids("move.l #0,a3")).not.toContain(
      "optimization/prefer-move-word-address",
    );
  });

  test("recognises standard LINK and UNLK sequences", () => {
    const setup = ["move.l a6,-(sp)", "move.l sp,a6", "add.w #-32,sp"].join(
      "\n",
    );
    const link = lint(setup).find(
      (d) => d.ruleId === "optimization/prefer-link-sequence",
    );
    expect(link?.suggestion?.replacement).toBe("\tlink a6,#-32");

    const teardown = ["move.l a6,sp", "move.l (sp)+,a6", "rts"].join("\n");
    const unlk = lint(teardown).find(
      (d) => d.ruleId === "optimization/prefer-unlk-sequence",
    );
    expect(unlk?.suggestion?.replacement).toBe("\tunlk a6");
  });

  // The opening MOVE.L to -(SP) sets N and Z; LINK sets nothing. Found by the
  // differential checker, which caught this claiming `safe` with no flag check.
  test("LINK is only safe where the condition codes the MOVE sets are dead", () => {
    const dead = [
      "move.l a6,-(sp)",
      "move.l sp,a6",
      "add.w #-32,sp",
      "moveq #0,d0",
      "rts",
    ].join("\n");
    expect(
      lint(dead).find((d) => d.ruleId === "optimization/prefer-link-sequence")
        ?.suggestion?.applicability,
    ).toBe("safe");

    const live = [
      "move.l a6,-(sp)",
      "move.l sp,a6",
      "add.w #-32,sp",
      "beq .out",
      ".out:",
      "rts",
    ].join("\n");
    expect(
      lint(live).find((d) => d.ruleId === "optimization/prefer-link-sequence")
        ?.suggestion?.applicability,
    ).toBe("conditional");
  });

  test("recognises a LINK sequence closed with ADDQ", () => {
    const setup = ["move.l a6,-(sp)", "move.l sp,a6", "addq.w #8,sp"].join(
      "\n",
    );
    const diagnostic = lint(setup).find(
      (d) => d.ruleId === "optimization/prefer-link-sequence",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlink a6,#8");
  });

  test("recognises a LINK sequence closed with a .L stack adjustment", () => {
    const setup = ["move.l a6,-(sp)", "move.l sp,a6", "add.l #-32,sp"].join(
      "\n",
    );
    const diagnostic = lint(setup).find(
      (d) => d.ruleId === "optimization/prefer-link-sequence",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlink a6,#-32");
  });

  test("accepts -32768 as the LINK frame size", () => {
    const setup = ["move.l a6,-(sp)", "move.l sp,a6", "add.w #-32768,sp"].join(
      "\n",
    );
    const diagnostic = lint(setup).find(
      (d) => d.ruleId === "optimization/prefer-link-sequence",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlink a6,#-32768");
  });
});

test("DIVU.W power-of-two proves discarded remainder when upper word is overwritten", () => {
  const source = [
    "move.l #100,d0",
    "divu.w #4,d0",
    "move.w d0,d1",
    "move.l #0,d0",
    "add.l d2,d3",
    "rts",
  ].join("\n");
  const diagnostic = lint(source).find(
    (d) => d.ruleId === "optimization/divu-word-power-of-two",
  );
  expect(diagnostic).toBeDefined();
  expect(diagnostic?.data?.upperWordUse).toBe("unused");
  expect(diagnostic?.suggestion?.applicability).toBe("safe");
});

test("DIVU.W power-of-two does not suggest a shift when the remainder word is definitely used", () => {
  const source = ["divu.w #4,d0", "swap d0", "move.l d0,d1", "rts"].join("\n");
  expect(ids(source)).not.toContain("optimization/divu-word-power-of-two");
});

test("DIVU.W power-of-two remains manual when remainder use is unknown", () => {
  const source = ["divu.w #4,d0", "rts"].join("\n");
  const diagnostic = lint(source).find(
    (d) => d.ruleId === "optimization/divu-word-power-of-two",
  );
  expect(diagnostic?.data?.upperWordUse).toBe("unknown");
  expect(diagnostic?.suggestion?.applicability).toBe("conditional");
});

describe("Flamewing address sequence rules", () => {
  test("folds ADDA immediate plus data-register ADDA into indexed LEA", () => {
    const source = ["adda.w #12,a0", "adda.l d1,a0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/address-arithmetic-indexed-lea",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlea 12(a0,d1.l),a0");
  });

  test("folds SUBA immediate plus address-register ADDA into indexed LEA", () => {
    const source = ["suba.w #8,a0", "adda.w a1,a0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/address-arithmetic-indexed-lea",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlea -8(a0,a1.w),a0");
  });

  test("does not fold when the index is the destination address register", () => {
    expect(
      ids(["adda.w #4,a0", "adda.l a0,a0", "rts"].join("\n")),
    ).not.toContain("optimization/address-arithmetic-indexed-lea");
  });
});

describe("Flamewing rotate and shift rules", () => {
  test("reduces known register-count word rotates", () => {
    const source = ["moveq #12,d1", "rol.w d1,d0", "move.l #0,d1", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/known-register-rotate",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tror.w #4,d0");
  });

  test("reduces known register-count long rotates through SWAP", () => {
    const source = ["moveq #20,d1", "ror.l d1,d0", "move.l #0,d1", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/known-register-rotate",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tswap d0\n\tror.l #4,d0",
    );
  });

  test("does not delete a MOVEQ whose count register remains live", () => {
    const source = ["moveq #12,d1", "rol.w d1,d0", "move.l d1,d2", "rts"].join(
      "\n",
    );
    expect(ids(source)).not.toContain("optimization/known-register-rotate");
  });

  test("uses ADDX for ROXL #1", () => {
    const diagnostic = lint(
      ["roxl.w #1,d0", "move.w d0,d1", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/roxl-to-addx");
    expect(diagnostic?.suggestion?.replacement).toBe("\taddx.w d0,d0");
  });

  test("recognises the LSL.B #7 rotate-and-mask speed tradeoff", () => {
    const diagnostic = lint(
      ["lsl.b #7,d0", "move.b d0,d1", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/lsl-byte-seven");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tror.b #1,d0\n\tandi.b #$80,d0",
    );
  });

  test("recognises the ASL.B #7 rotate-and-mask speed tradeoff, tracking V unlike LSL", () => {
    // add.l overwrites X/N/Z/V/C unconditionally, proving all of them (V
    // included) dead before the routine returns.
    const source = ["asl.b #7,d0", "add.l d2,d3", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/asl-byte-seven",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tror.b #1,d0\n\tandi.b #$80,d0",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("safe");

    // ASL's V is data-dependent (unlike LSL's, which is always clear), so a
    // later V read must block "safe" even though X/C alone would allow it.
    const vObserved = ["asl.b #7,d0", "bvs .over", ".over:", "rts"].join("\n");
    expect(
      lint(vObserved).find((d) => d.ruleId === "optimization/asl-byte-seven")
        ?.suggestion?.applicability,
    ).toBe("conditional");
  });

  test("reduces known register-count LSL.W #12 using rotate and mask", () => {
    const source = ["moveq #12,d1", "lsl.w d1,d0", "move.l #0,d1", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/known-register-shift-reduction",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tror.w #4,d0\n\tandi.w #$F000,d0",
    );
  });

  test("reduces known register-count LSR.W #12 using mask and rotate", () => {
    const source = ["moveq #12,d1", "lsr.w d1,d0", "move.l #0,d1", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/known-register-shift-reduction",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tandi.w #$F000,d0\n\trol.w #4,d0",
    );
  });

  test("reduces known register-count LSL.L #20 using word/SWAP operations", () => {
    const source = ["moveq #20,d1", "lsl.l d1,d0", "move.l #0,d1", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/known-register-shift-reduction",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tlsl.w #4,d0\n\tswap d0\n\tclr.w d0",
    );
  });

  test("reduces known register-count ASR.L #16 using SWAP/EXT", () => {
    const source = ["moveq #16,d1", "asr.l d1,d0", "move.l #0,d1", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/known-register-shift-reduction",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tswap d0\n\text.l d0");
  });

  test("does not reduce a register-count shift when the count register remains live", () => {
    const source = ["moveq #20,d1", "lsl.l d1,d0", "move.l d1,d2", "rts"].join(
      "\n",
    );
    expect(ids(source)).not.toContain(
      "optimization/known-register-shift-reduction",
    );
  });
});

describe("suspicious rules", () => {
  test("flags register self-MOVE without claiming it is safe to remove", () => {
    const diagnostics = lint("move.l d2,d2");
    const diagnostic = diagnostics.find(
      (d) => d.ruleId === "suspicious/self-move",
    );

    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.applicability).toBe("manual");
    expect(
      diagnostic?.notes?.some((note) => /condition codes/i.test(note.message)),
    ).toBe(true);
  });

  test("does not flag ordinary MOVE", () => {
    expect(ids("move.l d2,d3")).not.toContain("suspicious/self-move");
  });

  test("NOP advisory is disabled by default", () => {
    expect(ids("nop")).not.toContain("suspicious/nop");
  });

  test("NOP advisory can be explicitly enabled", () => {
    const diagnostics = lint("nop", {
      processors: ["mc68000"],
      rules: { "suspicious/nop": "info" },
    });

    expect(diagnostics.map((d) => d.ruleId)).toContain("suspicious/nop");
  });

  test("NOP before RTE is exempt as an interrupt-exit delay", () => {
    // Clearing the interrupt request has to reach the hardware before the RTE,
    // or a fast CPU returns while the level is still asserted.
    const on = {
      processors: ["mc68000" as const],
      rules: { "suspicious/nop": "info" as const },
    };
    const count = (source: string) =>
      lint(source, on).filter((d) => d.ruleId === "suspicious/nop").length;

    expect(count("    nop\n    rte")).toBe(0);
    // Some handlers use more than one.
    expect(count("    nop\n    nop\n    rte")).toBe(0);
    expect(count("    move.w #$4020,$dff09c\n    nop\n    rte")).toBe(0);

    // Only an interrupt return earns the exemption.
    expect(count("    nop\n    rts")).toBe(1);
    expect(count("    nop\n    move.l d0,d1\n    rte")).toBe(1);
    expect(count("    nop")).toBe(1);
    // RTR is deliberately not covered.
    expect(count("    nop\n    rtr")).toBe(1);
    // A label between the two is unusual but harmless: the NOP still falls
    // through to the RTE. An intervening instruction is what breaks it.
    expect(count("    nop\nhandler:\n    rte")).toBe(0);
    expect(count("    nop\n    nop\nhandler:\n    rte")).toBe(0);
  });
});

describe("configuration", () => {
  test("category can be disabled", () => {
    const diagnostics = lint("move.l #1,d0", {
      processors: ["mc68000"],
      categories: { optimization: false },
    });
    expect(diagnostics).toHaveLength(0);
  });
});

describe("CCR analysis", () => {
  test("flags are live when consumed before overwrite", () => {
    const source = [
      "cmp.l d0,d1",
      "movea.l (a0),a1",
      "beq .same",
      ".same:",
      "rts",
    ].join("\n");

    const diagnostics = lint(source);
    expect(diagnostics.map((d) => d.ruleId)).not.toContain(
      "suspicious/stale-condition-code",
    );
  });

  test("flags become unknown at RTS if they survive to return", () => {
    const ctx = fixtureContext(["add.l d0,d1", "rts"].join("\n"));
    expect(ctx.flags.isLiveAfter(0, "Z")).toBe("unknown");
  });

  test("a definite overwrite before RTS makes the older NZVC dead", () => {
    const source = ["add.l d0,d1", "move.l d2,d3", "rts"].join("\n");
    const ctx = fixtureContext(source);
    expect(ctx.flags.isLiveAfter(0, "Z")).toBe("dead");
    // MOVE preserves X, so ADD's X can still escape through RTS.
    expect(ctx.flags.isLiveAfter(0, "X")).toBe("unknown");
  });

  test("flags become unknown across a call with no summary", () => {
    const source = [
      "cmp.l d0,d1",
      "jsr helper",
      "beq .same",
      ".same:",
      "rts",
    ].join("\n");
    const ctx = fixtureContext(source);
    expect(
      ctx.flags
        .reachingDefinitionsBefore(2, "Z")
        .some((d) => d.kind === "unknown"),
    ).toBe(true);
  });

  test("warns when BEQ appears to expect MOVEA to set Z", () => {
    const source = ["movea.l d0,a0", "beq .null", ".null:", "rts"].join("\n");
    expect(ids(source)).toContain("suspicious/stale-condition-code");
  });

  test("does not warn when MOVEA deliberately preserves a prior CMP result", () => {
    const source = [
      "cmp.l d0,d1",
      "movea.l (a0),a1",
      "beq .equal",
      ".equal:",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain("suspicious/stale-condition-code");
  });

  test("populates quick arithmetic and simple constant rules", () => {
    const source = [
      "sub.l #8,d0",
      "add.w #-3,d1",
      "sub.l #-7,d2",
      "cmp.l #0,d3",
      "eor.l #-1,d4",
    ].join("\n");
    const found = ids(source);
    expect(found).toContain("optimization/prefer-subq");
    expect(found).toContain("optimization/prefer-subq-negative-add");
    expect(found).toContain("optimization/prefer-addq-negative-sub");
    expect(found).toContain("optimization/prefer-tst-zero");
    expect(found).toContain("optimization/prefer-not");
  });

  test("single-bit mask transforms are conditional when later flags may matter", () => {
    const source = ["or.l #8,d0", "beq .done", ".done:", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/prefer-bset",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
  });

  test("single-bit mask transform becomes safe after flags are overwritten", () => {
    const source = ["or.l #8,d0", "move.l d1,d2", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/prefer-bset",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("prefers BCLR for a one-bit AND mask", () => {
    // ~8 is all bits set except bit 3, so ANDing it out is equivalent to
    // clearing just that bit.
    const diagnostic = lint("and.l #~8,d0").find(
      (d) => d.ruleId === "optimization/prefer-bclr",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\tbclr.l #3,d0");
  });

  test("BSET/BCLR mask preference is offered on 68000/010/020/030/060 but not 68040", () => {
    // Verified with 68kcounter: both stay a clean win through 68030 and on
    // 68060; 68040 costs 2 cycles more than the mask form there.
    for (const cpu of [
      "mc68000",
      "mc68010",
      "mc68020",
      "mc68030",
      "mc68060",
    ] as const) {
      expect(ids("or.l #8,d0", { processors: [cpu] })).toContain(
        "optimization/prefer-bset",
      );
      expect(ids("and.l #~8,d0", { processors: [cpu] })).toContain(
        "optimization/prefer-bclr",
      );
    }
    expect(ids("or.l #8,d0", { processors: ["mc68040"] })).not.toContain(
      "optimization/prefer-bset",
    );
    expect(ids("and.l #~8,d0", { processors: ["mc68040"] })).not.toContain(
      "optimization/prefer-bclr",
    );
  });

  test("BCLR mask preference does not apply to non-power-of-two masks", () => {
    const diagnostics = lint("and.l #~9,d0");
    expect(
      diagnostics.some((d) => d.ruleId === "optimization/prefer-bclr"),
    ).toBe(false);
  });

  test("large logical shifts can collapse to zero, respecting CCR liveness", () => {
    const source = ["lsl.w #16,d0", "move.l d1,d2", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/shift-to-clear",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\tclr.w d0");
  });
});

describe("v0.8 sequence rules", () => {
  test("uses TST plus sign branch for BTST sign-bit tests", () => {
    const source = [
      "btst #31,d0",
      "beq.s .positive",
      "move.l d1,d2",
      ".positive:",
      "move.l d3,d4",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/btst-sign-branch",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\ttst.l d0\n\tbpl.s .positive",
    );
  });

  test("does not fold BTST branch across an independently reachable label", () => {
    const source = ["btst #7,d0", ".branch:", "bne .negative"].join("\n");
    expect(ids(source)).not.toContain("optimization/btst-sign-branch");
  });

  test("finds adjacent absolute CLR byte/word stores and offers the combined store", () => {
    const bytes = lint(["clr.b $1000", "clr.b $1001"].join("\n")).find(
      (d) => d.ruleId === "optimization/combine-adjacent-clr-bytes",
    );
    expect(bytes?.suggestion?.applicability).toBe("conditional");

    expect(ids(["clr.w $2000", "clr.w $2002"].join("\n"))).toContain(
      "optimization/combine-adjacent-clr-words",
    );
  });

  test("combines adjacent immediate stores using 68k big-endian ordering", () => {
    const bytes = lint(
      ["move.b #$12,$1000", "move.b #$34,$1001"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-move-bytes");
    expect(bytes?.suggestion?.description).toContain("#$1234");
    expect(bytes?.suggestion?.applicability).toBe("conditional");

    const words = lint(
      ["move.w #$1234,$2000", "move.w #$5678,$2002"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-move-words");
    expect(words?.suggestion?.description).toContain("#$12345678");
  });

  test("combines adjacent immediate stores through register-indirect displacement", () => {
    const source = [
      "bltafwm equ $44",
      "bltalwm equ $46",
      "move.w #$ffff,bltafwm(a6)",
      "move.w #$ffff,bltalwm(a6)",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/combine-adjacent-move-words",
    );
    expect(diagnostic?.suggestion?.description).toContain("bltafwm(a6)");
    expect(diagnostic?.suggestion?.description).toContain("#$ffffffff");
  });

  test("does not combine register-indirect displacement stores through different address registers", () => {
    const source = [
      "off1 equ $44",
      "off2 equ $46",
      "move.w #$1234,off1(a6)",
      "move.w #$5678,off2(a5)",
    ].join("\n");
    expect(ids(source)).not.toContain(
      "optimization/combine-adjacent-move-words",
    );
  });

  test("combines a bare (An) store with a matching displacement store", () => {
    const diagnostic = lint(
      ["move.w #$1234,(a6)", "move.w #$5678,2(a6)"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-move-words");
    expect(diagnostic?.suggestion?.description).toContain("(a6)");
    expect(diagnostic?.suggestion?.description).toContain("#$12345678");
  });

  test("combines adjacent immediate stores through postincrement", () => {
    const diagnostic = lint(
      ["move.w #$1234,(a1)+", "move.w #$5678,(a1)+"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-move-words");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmove.l #$12345678,(a1)+",
    );
  });

  test("combines adjacent immediate stores through predecrement with the byte order reversed", () => {
    // The second write lands at the lower (more significant) address, so it
    // becomes the high half -- backwards from every other addressing mode.
    const diagnostic = lint(
      ["move.w #$1234,-(a1)", "move.w #$5678,-(a1)"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-move-words");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmove.l #$56781234,-(a1)",
    );
  });

  test("does not combine byte-sized predecrement/postincrement through A7", () => {
    // -(a7)/(a7)+ always moves the stack pointer by 2 even for a byte access,
    // so two chained byte ops on A7 are two bytes apart, not one.
    expect(ids(["clr.b -(a7)", "clr.b -(a7)"].join("\n"))).not.toContain(
      "optimization/combine-adjacent-clr-bytes",
    );
    expect(ids(["clr.b -(a2)", "clr.b -(a2)"].join("\n"))).toContain(
      "optimization/combine-adjacent-clr-bytes",
    );
  });

  test("combines adjacent memory-to-memory copies through matching postincrement", () => {
    const diagnostic = lint(
      ["move.w (a0)+,(a1)+", "move.w (a0)+,(a1)+"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-copy-words");
    expect(diagnostic?.suggestion?.replacement).toBe("\tmove.l (a0)+,(a1)+");
  });

  test("combines adjacent memory-to-memory copies through matching predecrement", () => {
    const diagnostic = lint(
      ["move.w -(a0),-(a1)", "move.w -(a0),-(a1)"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-copy-words");
    expect(diagnostic?.suggestion?.replacement).toBe("\tmove.l -(a0),-(a1)");
  });

  test("combines a moving source with an adjacent fixed destination, and the mirror image", () => {
    const forward = lint(
      ["move.w (a0)+,$100(a1)", "move.w (a0)+,$102(a1)"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-copy-words");
    expect(forward?.suggestion?.replacement).toBe("\tmove.l (a0)+,$100(a1)");

    const mirrored = lint(
      ["move.w $100(a0),(a1)+", "move.w $102(a0),(a1)+"].join("\n"),
    ).find((d) => d.ruleId === "optimization/combine-adjacent-copy-words");
    expect(mirrored?.suggestion?.replacement).toBe("\tmove.l $100(a0),(a1)+");
  });

  test("does not combine a copy that reads and writes through the same address register", () => {
    const source = ["move.w $4(a0),(a0)+", "move.w $6(a0),(a0)+"].join("\n");
    expect(ids(source)).not.toContain(
      "optimization/combine-adjacent-copy-words",
    );
  });
});

describe("v0.9 local peepholes", () => {
  test("does not suggest TST for address-register CMP #0", () => {
    expect(ids("cmp.l #0,a0")).not.toContain("optimization/prefer-tst-zero");
    expect(ids("cmp.l #0,d0")).toContain("optimization/prefer-tst-zero");
  });

  // Off by default, since vasm drops the zero displacement under its default
  // optimisations; asked for here so the rewrite itself stays covered.
  const withZeroDisplacement = {
    processors: ["mc68000" as const],
    presets: ["style" as const],
  };

  test("removes zero address-register displacements", () => {
    // Replacements are line-scoped, so this rewrites the operand within the whole
    // instruction rather than handing back a bare operand fragment.
    const diagnostic = lint("move.l 0(a0),d0", withZeroDisplacement).find(
      (d) => d.ruleId === "optimization/redundant-zero-displacement",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tmove.l (a0),d0");
    expect(diagnostic?.message).toContain("(a0)");
  });

  // The measurement is of the written form. Under vasm's default optimisations
  // that is not what the output costs; with optimisations off it is.
  test("measures the zero-displacement rewrite against the written form", () => {
    const diagnostic = lint("move.l 0(a0),d0", withZeroDisplacement).find(
      (d) => d.ruleId === "optimization/redundant-zero-displacement",
    );
    expect(diagnostic?.suggestion?.impact?.sizeBytes?.delta).toBe(-2);
    expect(diagnostic?.suggestion?.impact?.assessment).toBe("improvement");
  });

  test("is off unless asked for", () => {
    expect(ids("move.l 0(a0),d0")).not.toContain(
      "optimization/redundant-zero-displacement",
    );
  });

  test("rewrites only the matched operand, leaving the rest of the line alone", () => {
    const diagnostic = lint("move.l 0(a0),0(a1)", withZeroDisplacement).find(
      (d) => d.ruleId === "optimization/redundant-zero-displacement",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tmove.l (a0),0(a1)");
  });

  test("uses LEA for larger immediate address-register arithmetic", () => {
    expect(
      lint("add.l #100,a2").find(
        (d) => d.ruleId === "optimization/address-add-to-lea",
      )?.suggestion?.replacement,
    ).toBe("\tlea 100(a2),a2");
    expect(
      lint("sub.w #20,a3").find(
        (d) => d.ruleId === "optimization/address-sub-to-lea",
      )?.suggestion?.replacement,
    ).toBe("\tlea -20(a3),a3");
    expect(ids("add.l #8,a2")).not.toContain("optimization/address-add-to-lea");
  });

  test("uses PEA for signed-16-bit immediate pushes but respects CCR", () => {
    const safe = lint(
      ["move.l #123,-(sp)", "move.l d0,d1", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/push-immediate-pea");
    expect(safe?.suggestion?.replacement).toBe("\tpea 123.w");
    expect(safe?.suggestion?.applicability).toBe("safe");

    const escaping = lint(["move.l #123,-(sp)", "rts"].join("\n")).find(
      (d) => d.ruleId === "optimization/push-immediate-pea",
    );
    expect(escaping?.suggestion?.applicability).toBe("conditional");
  });

  test("accepts -32768 as a sign-extending word immediate for PEA", () => {
    expect(ids("move.l #-32768,-(sp)")).toContain(
      "optimization/push-immediate-pea",
    );
    expect(ids("move.l #-32769,-(sp)")).not.toContain(
      "optimization/push-immediate-pea",
    );
  });

  test("reduces single-register MOVEM but rejects MOVEM.W to Dn", () => {
    expect(ids("movem.l d0,(a0)")).toContain(
      "optimization/single-register-movem",
    );
    expect(ids("movem.w (a0),d0")).not.toContain(
      "optimization/single-register-movem",
    );
  });

  test("uses low-word masks for BSET/BCLR when CCR differences are dead", () => {
    const source = ["bset.l #3,d0", "move.l d1,d2", "rts"].join("\n");
    const bset = lint(source).find(
      (d) => d.ruleId === "optimization/bset-low-word-mask",
    );
    // The mask is written as a shift of the bit number rather than the value it
    // produces, so it says which bit is meant and keeps a symbolic bit number.
    expect(bset?.suggestion?.replacement).toBe("\tor.w #1<<3,d0");
    expect(bset?.suggestion?.applicability).toBe("safe");

    expect(
      lint("bclr.l #7,d1").find(
        (d) => d.ruleId === "optimization/bclr-low-word-mask",
      )?.suggestion?.replacement,
    ).toBe("\tand.w #~(1<<7),d1");

    expect(
      lint("bchg.l #5,d2").find(
        (d) => d.ruleId === "optimization/bchg-low-word-mask",
      )?.suggestion?.replacement,
    ).toBe("\teor.w #1<<5,d2");
  });

  test("suggests two ADDs for two-bit byte/word shifts on supported CPUs", () => {
    const diagnostic = lint(
      ["asl.w #2,d2", "move.l d0,d1", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/shift-two-adds");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tadd.w d2,d2\n\tadd.w d2,d2",
    );

    const cpu060 = lint("asl.w #2,d2", { processors: ["mc68060"] });
    expect(cpu060.map((d) => d.ruleId)).not.toContain(
      "optimization/shift-two-adds",
    );
  });

  test("extends BTST sign-branch folding to memory bit 7", () => {
    const source = [
      "btst #7,(a0)",
      "beq .positive",
      "move.l d0,d1",
      ".positive:",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/btst-sign-branch",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\ttst.b (a0)\n\tbpl .positive",
    );
  });
});

describe("register analysis", () => {
  test("tracks a known-zero data register into a CLR optimisation", () => {
    const source = ["moveq #0,d7", "clr.l -(a0)", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/known-zero-clear",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tmove.l d7,-(a0)");
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
  });

  test("extends the known-zero CLR swap to every memory destination", () => {
    // Verified with 68kcounter: every memory-destination CLR form measures
    // slower than MOVE from a known-zero register on 68000, not just
    // predecrement and indexed, which is all ASP68K's own table covers.
    const rep = (dest: string) =>
      lint(["moveq #0,d7", `clr.w ${dest}`, "rts"].join("\n")).find(
        (d) => d.ruleId === "optimization/known-zero-clear",
      )?.suggestion?.replacement;
    expect(rep("(a0)")).toBe("\tmove.w d7,(a0)");
    expect(rep("(a0)+")).toBe("\tmove.w d7,(a0)+");
    expect(rep("4(a0)")).toBe("\tmove.w d7,4(a0)");
    expect(rep("$1000")).toBe("\tmove.w d7,$1000");
  });

  test("does not assume a register is dead merely because the routine returns", () => {
    const source = ["move.l #42,(a0)", "rts"].join("\n");
    const ctx = fixtureContext(source);
    expect(ctx.registers.isLiveAfter(0, "d0")).toBe("unknown");
  });

  test("finds a dead scratch register when it is overwritten before return", () => {
    const source = ["move.l #42,(a0)", "moveq #0,d0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/move-immediate-via-scratch",
    );
    expect(diagnostic?.suggestion?.replacement).toContain("moveq #42,d0");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });
});

describe("v0.11 register-driven rules", () => {
  test("uses a dead data register to compare an address register with zero", () => {
    const source = ["cmp.l #0,a0", "moveq #1,d0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/cmp-zero-address-via-scratch",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tmove.l a0,d0");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("does not apply the address-register scratch comparison to CMP.W", () => {
    expect(ids("cmp.w #0,a0")).not.toContain(
      "optimization/cmp-zero-address-via-scratch",
    );
  });

  test("combines consecutive ADDQ.L operations when flags are dead", () => {
    const source = ["addq.l #3,d0", "addq.l #5,d0", "add.l d1,d2", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/combine-consecutive-addq",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\taddq.l #8,d0");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("does not use the full-immediate ADD fallback on mc68000 when the sum exceeds 8", () => {
    const source = ["addq.l #5,d0", "addq.l #6,d0", "move.l d1,d2", "rts"].join(
      "\n",
    );
    expect(
      lint(source, { processors: ["mc68000"] }).map((d) => d.ruleId),
    ).not.toContain("optimization/combine-consecutive-addq");
  });

  test("retains the source-backed full-immediate ADD fallback for mc68030", () => {
    const source = ["addq.l #5,d0", "addq.l #6,d0", "move.l d1,d2", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source, { processors: ["mc68030"] }).find(
      (d) => d.ruleId === "optimization/combine-consecutive-addq",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tadd.l #11,d0");
  });

  test("keeps combined ADDQ conditional when carry/overflow flags are observed", () => {
    const source = [
      "addq.l #3,d0",
      "addq.l #5,d0",
      "bcs .carry",
      ".carry:",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/combine-consecutive-addq",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
  });

  test("combines two ADDQs staying within quick range on any CPU", () => {
    // Collapsing into one still-quick ADDQ is a strict size/instruction-count
    // win everywhere, so this branch carries no CPU restriction, unlike the
    // full-immediate ADD fallback for a sum over 8.
    const source = ["addq.l #3,d0", "addq.l #5,d0", "add.l d1,d2", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source, { processors: ["mc68020"] }).find(
      (d) => d.ruleId === "optimization/combine-consecutive-addq",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\taddq.l #8,d0");
  });

  test("does not use the full-immediate ADD fallback outside 68010/68030 either", () => {
    const source = ["addq.l #5,d0", "addq.l #6,d0", "move.l d1,d2", "rts"].join(
      "\n",
    );
    expect(
      lint(source, { processors: ["mc68020"] }).map((d) => d.ruleId),
    ).not.toContain("optimization/combine-consecutive-addq");
  });

  describe("combine consecutive shifts", () => {
    const ID = "optimization/combine-consecutive-shift";

    test("combines two immediate shifts that still fit one instruction", () => {
      const diagnostic = lint(["lsl.l #2,d2", "lsl.l #6,d2"].join("\n")).find(
        (d) => d.ruleId === ID,
      );
      expect(diagnostic?.suggestion?.replacement).toBe("\tlsl.l #8,d2");
      expect(diagnostic?.suggestion?.applicability).toBe("safe");

      expect(
        lint(["lsr.w #2,d0", "lsr.w #2,d0"].join("\n")).find(
          (d) => d.ruleId === ID,
        )?.suggestion?.replacement,
      ).toBe("\tlsr.w #4,d0");
    });

    test("routes an over-8 total through MOVEQ plus a register-count shift on 68000", () => {
      const source = ["lsl.w #8,d2", "lsl.w #4,d2", "move.l d1,d3", "rts"].join(
        "\n",
      );
      const diagnostic = lint(source, { processors: ["mc68000"] }).find(
        (d) => d.ruleId === ID,
      );
      expect(diagnostic?.suggestion?.replacement).toBe(
        "\tmoveq #12,d3\n\tlsl.w d3,d2",
      );
    });

    test("does not offer the over-8 fallback outside 68000", () => {
      const source = ["lsl.w #8,d2", "lsl.w #4,d2", "move.l d1,d3", "rts"].join(
        "\n",
      );
      expect(ids(source, { processors: ["mc68020"] })).not.toContain(ID);
    });

    test("does not combine shifts of different direction, size, or register", () => {
      expect(ids(["lsl.w #2,d0", "lsr.w #2,d0"].join("\n"))).not.toContain(ID);
      expect(ids(["lsl.w #2,d0", "lsl.l #2,d0"].join("\n"))).not.toContain(ID);
      expect(ids(["lsl.w #2,d0", "lsl.w #2,d1"].join("\n"))).not.toContain(ID);
    });

    test("declines the over-8 fallback without a free scratch register", () => {
      // Every data register is either the shift target or already in use, so
      // there is nothing MOVEQ could safely carry the count in.
      const source = [
        "lsl.w #8,d0",
        "lsl.w #4,d0",
        "move.w d1,d2",
        "move.w d3,d4",
        "move.w d5,d6",
        "move.w d7,d0",
      ].join("\n");
      expect(ids(source, { processors: ["mc68000"] })).not.toContain(ID);
    });
  });

  describe("fold an intermediate register that only carries a value onward", () => {
    const ID = "optimization/fold-redundant-intermediate";

    test("folds a load whose scratch register dies at the operation", () => {
      const diagnostic = lint(
        ["move.w x_speed,d1", "add.w d1,d0", "moveq #0,d1", "rts"].join("\n"),
      ).find((d) => d.ruleId === ID);
      expect(diagnostic?.suggestion?.replacement).toBe("\tadd.w x_speed,d0");
      expect(diagnostic?.suggestion?.applicability).toBe("safe");
    });

    test("covers the addressing modes that read the same value either way", () => {
      const rep = (first: string, second: string) =>
        lint([first, second, "moveq #0,d1", "rts"].join("\n")).find(
          (d) => d.ruleId === ID,
        )?.suggestion?.replacement;
      expect(rep("move.w 2(a3),d1", "cmp.w d1,d4")).toBe("\tcmp.w 2(a3),d4");
      expect(rep("move.w (a1,d2.w),d1", "and.w d1,d5")).toBe(
        "\tand.w (a1,d2.w),d5",
      );
      expect(rep("move.b (a0),d1", "sub.b d1,d3")).toBe("\tsub.b (a0),d3");
      expect(rep("move.w table(pc),d1", "or.w d1,d5")).toBe(
        "\tor.w table(pc),d5",
      );
    });

    test("does not fold into EOR, which has no source-EA form", () => {
      // The 68k only encodes EOR Dn,<ea>; `eor.w (a1),d3` is not an instruction.
      expect(
        ids(["move.w (a1),d1", "eor.w d1,d3", "moveq #0,d1", "rts"].join("\n")),
      ).not.toContain(ID);
    });

    test("keeps the load when the scratch register is still needed", () => {
      expect(
        ids(
          ["move.w x_speed,d1", "add.w d1,d0", "move.w d1,d5", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
    });

    test("does not fold when the operation writes a register the load addresses through", () => {
      expect(
        ids(["move.w (a0),d1", "add.w d1,a0", "moveq #0,d1", "rts"].join("\n")),
      ).not.toContain(ID);
    });

    test("requires the flags to be dead when folding into ADDA, which preserves CCR", () => {
      // MOVE sets N/Z/V/C and ADDA leaves them alone, so the folded form drops
      // flags the original pair left behind.
      const live = [
        "move.w section,d1",
        "add.w d1,a0",
        "beq .x",
        ".x:",
        "moveq #0,d1",
        "rts",
      ].join("\n");
      expect(
        lint(live).find((d) => d.ruleId === ID)?.suggestion?.applicability,
      ).toBe("conditional");

      const dead = [
        "move.w section,d1",
        "add.w d1,a0",
        "moveq #0,d1",
        "rts",
      ].join("\n");
      expect(
        lint(dead).find((d) => d.ruleId === ID)?.suggestion?.applicability,
      ).toBe("safe");
    });

    test("does not fold a byte-sized load into an address-register destination", () => {
      // ADDA.B/MOVEA.B do not exist.
      expect(
        ids(["move.b (a0),d1", "add.b d1,a1", "moveq #0,d1", "rts"].join("\n")),
      ).not.toContain(ID);
    });

    test("collapses a load/store pair into a memory-to-memory move", () => {
      const diagnostic = lint(
        ["move.w (a1,d1.w),d3", "move.w d3,(a0)", "moveq #0,d3", "rts"].join(
          "\n",
        ),
      ).find((d) => d.ruleId === ID);
      expect(diagnostic?.suggestion?.replacement).toBe(
        "\tmove.w (a1,d1.w),(a0)",
      );
      expect(diagnostic?.suggestion?.applicability).toBe("safe");

      expect(
        lint(
          [
            "move.l planes+4,d1",
            "move.l d1,planes+0",
            "moveq #0,d1",
            "rts",
          ].join("\n"),
        ).find((d) => d.ruleId === ID)?.suggestion?.replacement,
      ).toBe("\tmove.l planes+4,planes+0");
    });

    test("does not fold when the store addresses through the scratch register", () => {
      // The store currently reads the freshly loaded value to form its address;
      // folded, it would index with whatever the register held before.
      expect(
        ids(
          ["move.w (a1),d3", "move.w d3,(a0,d3.w)", "moveq #0,d3", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
    });

    test("requires flags to be dead when the destination is an address register", () => {
      // MOVEA does not set condition codes, so folding drops the MOVE's.
      const live = [
        "move.w (a1),d3",
        "move.w d3,a2",
        "beq .x",
        ".x:",
        "moveq #0,d3",
        "rts",
      ].join("\n");
      expect(
        lint(live).find((d) => d.ruleId === ID)?.suggestion?.applicability,
      ).toBe("conditional");
    });

    test("reaches memory only through MOVE, which is the encoding that allows it", () => {
      // A memory destination is reachable for a copy and not for arithmetic,
      // because of how the 68k encodes each, not because of the shape matched.
      expect(
        ids(
          ["move.w (a0),d1", "move.w d1,(a1)", "moveq #0,d1", "rts"].join("\n"),
        ),
      ).toContain(ID);
      expect(
        ids(
          ["move.w (a0),d1", "add.w d1,(a1)", "moveq #0,d1", "rts"].join("\n"),
        ),
      ).not.toContain(ID);
    });

    test("reports each site once, whichever consumer it is", () => {
      for (const consumer of ["add.w d1,d0", "move.w d1,(a1)", "cmp.w d1,d0"]) {
        const hits = lint(
          ["move.w (a0),d1", consumer, "moveq #0,d1", "rts"].join("\n"),
        ).filter((d) => d.ruleId === ID);
        expect(hits).toHaveLength(1);
      }
    });
  });

  describe("combine postincrement loads into MOVEM", () => {
    const ID = "optimization/combine-loads-into-movem";
    const rep = (lines: string[]) =>
      lint([...lines, "moveq #0,d7", "rts"].join("\n")).find(
        (d) => d.ruleId === ID,
      )?.suggestion?.replacement;

    test("folds a run of three or more into one MOVEM", () => {
      expect(
        rep(["move.l (a0)+,d0", "move.l (a0)+,d1", "move.l (a0)+,d2"]),
      ).toBe("\tmovem.l (a0)+,d0-d2");
      expect(
        rep([
          "move.l (a0)+,d0",
          "move.l (a0)+,d1",
          "move.l (a0)+,d2",
          "move.l (a0)+,d3",
          "move.l (a0)+,d4",
          "move.l (a0)+,d5",
        ]),
      ).toBe("\tmovem.l (a0)+,d0-d5");
    });

    test("does not fold a pair, which measures worse than the MOVEM", () => {
      // On 68000 two loads are the same 4 bytes as movem.l and 4 cycles
      // faster, so the win only starts at three.
      expect(
        ids(
          ["move.l (a0)+,d0", "move.l (a0)+,d1", "moveq #0,d7", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
    });

    test("register numbers may skip, since the list is a bitmask", () => {
      expect(
        rep(["move.l (a0)+,d1", "move.l (a0)+,d3", "move.l (a0)+,d5"]),
      ).toBe("\tmovem.l (a0)+,d1/d3/d5");
      expect(
        rep(["move.l (a0)+,d0", "move.l (a0)+,d1", "move.l (a0)+,a1"]),
      ).toBe("\tmovem.l (a0)+,d0/d1/a1");
    });

    test("needs MOVEM's own register order, one pointer, and no label between", () => {
      // MOVEM fills D0-D7 then A0-A7, so a descending run loads different
      // values into different registers than the individual moves would.
      expect(
        ids(
          ["move.l (a0)+,d2", "move.l (a0)+,d1", "move.l (a0)+,d0", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
      expect(
        ids(
          ["move.l (a0)+,d0", "move.l (a1)+,d1", "move.l (a0)+,d2", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
      expect(
        ids(
          [
            "move.l (a0)+,d0",
            "move.l (a0)+,d1",
            ".mid:",
            "move.l (a0)+,d2",
            "rts",
          ].join("\n"),
        ),
      ).not.toContain(ID);
    });

    test("will not load into the pointer it is walking", () => {
      expect(
        ids(
          ["move.l (a0)+,d0", "move.l (a0)+,d1", "move.l (a0)+,a0", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
    });

    test("is offered only for the targets the win is measured on", () => {
      // 68kcounter models 68000 through 68060: 68000/68010/68020 agree from
      // three registers up. 68030 does not -- checked at every register
      // count from 2 through 8, MOVEM is consistently 6 to 10 cycles slower
      // there than the loads it replaces. 68040 is consistently 3 cycles
      // slower at every count. 68060 ties the loads it replaces (never
      // faster, never slower) and is a pure byte win.
      const source = [
        "move.l (a0)+,d0",
        "move.l (a0)+,d1",
        "move.l (a0)+,d2",
        "moveq #0,d7",
        "rts",
      ].join("\n");
      for (const cpu of ["mc68000", "mc68010", "mc68020", "mc68060"] as const) {
        expect([cpu, ids(source, { processors: [cpu] }).includes(ID)]).toEqual([
          cpu,
          true,
        ]);
      }
      for (const cpu of ["mc68030", "mc68040", "cpu32"] as const) {
        expect([cpu, ids(source, { processors: [cpu] }).includes(ID)]).toEqual([
          cpu,
          false,
        ]);
      }
    });

    test("leaves word-sized runs alone, because MOVEM.W sign-extends", () => {
      // `move.w (a0)+,d0` writes only the low half; MOVEM.W sign-extends into
      // the whole register, so a word run is not the same instruction.
      expect(
        ids(
          ["move.w (a0)+,d0", "move.w (a0)+,d1", "move.w (a0)+,d2", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
    });

    test("needs the flags each MOVE sets to be dead, since MOVEM sets none", () => {
      const live = [
        "move.l (a0)+,d0",
        "move.l (a0)+,d1",
        "move.l (a0)+,d2",
        "beq .x",
        ".x:",
        "rts",
      ].join("\n");
      expect(
        lint(live).find((d) => d.ruleId === ID)?.suggestion?.applicability,
      ).toBe("conditional");
    });

    test("reports a run once, from its first load", () => {
      const source = [
        "move.l (a0)+,d0",
        "move.l (a0)+,d1",
        "move.l (a0)+,d2",
        "move.l (a0)+,d3",
        "moveq #0,d7",
        "rts",
      ].join("\n");
      const hits = lint(source).filter((d) => d.ruleId === ID);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.loc.line).toBe(1);
      expect(hits[0]?.span?.endLine).toBe(4);
    });
  });

  describe("combine consecutive single-bit operations", () => {
    const ID = "optimization/combine-consecutive-bit-ops";
    const rep = (lines: string[]) =>
      lint(lines.join("\n")).find((d) => d.ruleId === ID)?.suggestion
        ?.replacement;

    test("merges a run into one masked operation, sized to the highest bit", () => {
      expect(rep(["bclr #0,d0", "bclr #4,d0", "moveq #0,d7", "rts"])).toBe(
        "\tand.b #$ee,d0",
      );
      expect(
        rep([
          "bclr #0,d0",
          "bclr #4,d0",
          "bclr #8,d0",
          "bclr #12,d0",
          "moveq #0,d7",
          "rts",
        ]),
      ).toBe("\tand.w #$eeee,d0");
      expect(rep(["bset #0,d0", "bset #4,d0", "moveq #0,d7", "rts"])).toBe(
        "\tor.b #$11,d0",
      );
      expect(rep(["bchg #3,d0", "bchg #5,d0", "moveq #0,d7", "rts"])).toBe(
        "\teor.b #$28,d0",
      );
    });

    test("renders a mask reaching bit 31 unsigned", () => {
      // `& limit` works on a signed 32-bit value, so the unsigned coercion has
      // to come last or the mask renders as a negative number.
      expect(rep(["bset #31,d0", "bset #0,d0", "moveq #0,d7", "rts"])).toBe(
        "\tor.l #$80000001,d0",
      );
      expect(rep(["bclr #16,d0", "bclr #20,d0", "moveq #0,d7", "rts"])).toBe(
        "\tand.l #$ffeeffff,d0",
      );
    });

    test("keeps symbolic bit numbers, with each shift parenthesised", () => {
      expect(
        rep([
          "ON equ 3",
          "OFF equ 5",
          "bclr #ON,d0",
          "bclr #OFF,d0",
          "moveq #0,d7",
          "rts",
        ]),
      ).toBe("\tand.b #~((1<<ON)|(1<<OFF)),d0");
      expect(
        rep([
          "ON equ 3",
          "OFF equ 5",
          "bset #ON,d0",
          "bset #OFF,d0",
          "moveq #0,d7",
          "rts",
        ]),
      ).toBe("\tor.b #(1<<ON)|(1<<OFF),d0");
    });

    test("BCHG on the same bit twice cancels, so there is nothing to suggest", () => {
      expect(
        ids(["bchg #3,d0", "bchg #3,d0", "moveq #0,d7", "rts"].join("\n")),
      ).not.toContain(ID);
    });

    test("needs one register, one operation, and no label between", () => {
      expect(
        ids(["bclr #0,d0", "bclr #4,d1", "moveq #0,d7", "rts"].join("\n")),
      ).not.toContain(ID);
      expect(
        ids(["bclr #0,d0", "bset #4,d0", "moveq #0,d7", "rts"].join("\n")),
      ).not.toContain(ID);
      expect(
        ids(
          ["bclr #0,d0", ".mid:", "bclr #4,d0", "moveq #0,d7", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
    });

    test("reports a run once, from its first instruction", () => {
      const source = [
        "bclr #0,d0",
        "bclr #4,d0",
        "bclr #8,d0",
        "moveq #0,d7",
        "rts",
      ].join("\n");
      const hits = lint(source).filter((d) => d.ruleId === ID);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.loc.line).toBe(1);
      expect(hits[0]?.suggestion?.replacement).toBe("\tand.w #$feee,d0");
    });

    test("needs the flags the masked form changes to be dead", () => {
      // BCLR sets Z from the bit it tested; AND sets N/Z from the whole result.
      const live = ["bclr #0,d0", "bclr #4,d0", "beq .x", ".x:", "rts"].join(
        "\n",
      );
      expect(
        lint(live).find((d) => d.ruleId === ID)?.suggestion?.applicability,
      ).toBe("conditional");
    });

    test("does not merge a run across conditional-assembly arms", () => {
      // The CACR cache-control code this rule was found in is written exactly
      // this way, so merging across the ELSE would produce a mask for bits from
      // a branch that never assembles together.
      const source = [
        "ifeq CACHE",
        "bclr #0,d0",
        "bclr #8,d0",
        "else",
        "bclr #4,d0",
        "bclr #12,d0",
        "endc",
        "moveq #0,d7",
        "rts",
      ].join("\n");
      const hits = lint(source).filter((d) => d.ruleId === ID);
      expect(hits.map((d) => [d.span?.startLine, d.span?.endLine])).toEqual([
        [2, 3],
        [5, 6],
      ]);
    });
  });

  describe("storing zero with CLR", () => {
    const ID = "optimization/zero-store-to-clear";

    test("drops the immediate from a zero store", () => {
      const diagnostic = lint("move.w #0,$64(a6)").find((d) => d.ruleId === ID);
      expect(diagnostic?.suggestion?.replacement).toBe("\tclr.w $64(a6)");
      // Conditional because a 68000 CLR reads before writing, so a write-only
      // register briefly holds bus noise between the two cycles.
      expect(diagnostic?.suggestion?.applicability).toBe("conditional");
      expect(
        diagnostic?.notes?.some((n) => n.message.includes("bus noise")),
      ).toBe(true);

      expect(
        lint("move.l #0,(a0)").find((d) => d.ruleId === ID)?.suggestion
          ?.replacement,
      ).toBe("\tclr.l (a0)");
      expect(
        lint("move.w #0,(a0)+").find((d) => d.ruleId === ID)?.suggestion
          ?.replacement,
      ).toBe("\tclr.w (a0)+");
    });

    test("leaves data registers to the register-specific rules", () => {
      expect(ids("move.l #0,d0")).not.toContain(ID);
      expect(ids("move.l #0,a0")).not.toContain(ID);
    });

    test("fires on any immediate that evaluates to zero", () => {
      expect(ids("move.w #1,$64(a6)")).not.toContain(ID);
      // A named constant that happens to be zero still folds. CLR cannot carry
      // the name, so the report path's own symbols-lost note is what tells the
      // reader the replacement stops tracking it.
      const named = lint("CITY_ENDMARK equ 0\nmove.w #CITY_ENDMARK,(a1)+").find(
        (d) => d.ruleId === ID,
      );
      expect(named?.suggestion?.replacement).toBe("\tclr.w (a1)+");
      expect(named?.data?.symbolsLost).toEqual(["CITY_ENDMARK"]);
    });
  });

  describe("intermediate registers that carry a value nothing else needs", () => {
    const ID = "optimization/fold-redundant-intermediate";
    const rep = (lines: string[]) =>
      lint(lines.join("\n")).find((d) => d.ruleId === ID)?.suggestion
        ?.replacement;

    test("folds a register copy that only feeds the next instruction", () => {
      expect(rep(["move.w d2,d1", "add.w d1,d0", "moveq #0,d1", "rts"])).toBe(
        "\tadd.w d2,d0",
      );
      expect(
        rep(["move.w d4,d6", "move.w d6,4(a3)", "moveq #0,d6", "rts"]),
      ).toBe("\tmove.w d4,4(a3)");
      expect(rep(["move.l a0,d0", "move.l d0,d1", "moveq #0,d0", "rts"])).toBe(
        "\tmove.l a0,d1",
      );
    });

    test("folds an immediate that pays for its own extension word either way", () => {
      expect(
        rep(["move.w #$7fe,d3", "and.w d3,d0", "moveq #0,d3", "rts"]),
      ).toBe("\tand.w #$7fe,d0");
      expect(
        rep(["move.w #$7fff,d2", "move.w d2,$96(a6)", "moveq #0,d2", "rts"]),
      ).toBe("\tmove.w #$7fff,$96(a6)");
    });

    test("leaves the MOVEQ-via-scratch idiom alone, which is smaller than folding", () => {
      // move-immediate-via-scratch recommends exactly this shape; folding it
      // back measures 2 bytes and 4 cycles worse on 68000.
      expect(
        ids(
          ["moveq #-1,d0", "move.l d0,$44(a6)", "moveq #0,d0", "rts"].join(
            "\n",
          ),
        ),
      ).not.toContain(ID);
      expect(
        ids(["moveq #15,d3", "and.l d3,d0", "moveq #0,d3", "rts"].join("\n")),
      ).not.toContain(ID);
      // A long immediate MOVEQ could have carried is the same story however it
      // is spelled, since prefer-moveq will rewrite the load itself.
      expect(
        ids(["move.l #20,d3", "add.l d3,d0", "moveq #0,d3", "rts"].join("\n")),
      ).not.toContain(ID);
      // Out of MOVEQ's reach, the immediate costs its extension word regardless,
      // so folding drops a whole instruction.
      expect(
        rep(["move.l #$12345,d3", "add.l d3,d0", "moveq #0,d3", "rts"]),
      ).toBe("\tadd.l #$12345,d0");
    });
  });

  test("tracks constants through simple full-register arithmetic", () => {
    const source = ["moveq #4,d7", "sub.l #4,d7", "clr.l -(a0)", "rts"].join(
      "\n",
    );
    const ctx = fixtureContext(source);
    expect(ctx.registers.knownConstantBefore(2, "d7")).toBe(0);
  });

  test("MOVEM register lists participate in register liveness", () => {
    const source = ["move.l #42,(a0)", "movem.l d0-d2,-(sp)", "rts"].join("\n");
    const ctx = fixtureContext(source);
    expect(ctx.registers.isLiveAfter(0, "d0")).toBe("live");
  });
});

describe("v0.12 simple multiply rules", () => {
  test("replaces signed/unsigned word multiply by zero with MOVEQ", () => {
    expect(
      lint("muls.w #0,d2").find(
        (d) => d.ruleId === "optimization/multiply-word-by-zero",
      )?.suggestion?.replacement,
    ).toBe("\tmoveq #0,d2");
    expect(ids("mulu.w #0,d3")).toContain("optimization/multiply-word-by-zero");
  });

  test("replaces signed word multiply by one with EXT.L", () => {
    const diagnostic = lint("muls.w #1,d4").find(
      (d) => d.ruleId === "optimization/muls-word-by-one",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\text.l d4");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("offers the unsigned multiply-by-one zero-extension sequence only on useful targets", () => {
    const diagnostic = lint("mulu.w #1,d5").find(
      (d) => d.ruleId === "optimization/mulu-word-by-one",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tswap d5\n\tclr.w d5\n\tswap d5",
    );
    expect(
      lint("mulu.w #1,d5", { processors: ["mc68060"] }).map((d) => d.ruleId),
    ).not.toContain("optimization/mulu-word-by-one");
  });

  test("uses EXT+ASL for signed word powers of two and respects flag liveness", () => {
    const safeSource = ["muls.w #8,d0", "add.l d1,d2", "rts"].join("\n");
    const safe = lint(safeSource).find(
      (d) => d.ruleId === "optimization/muls-word-power-of-two",
    );
    expect(safe?.suggestion?.replacement).toBe("\text.l d0\n\tasl.l #3,d0");
    expect(safe?.suggestion?.applicability).toBe("safe");

    const liveSource = [
      "muls.w #8,d0",
      "bvs .overflow",
      ".overflow:",
      "rts",
    ].join("\n");
    const live = lint(liveSource).find(
      (d) => d.ruleId === "optimization/muls-word-power-of-two",
    );
    expect(live?.suggestion?.applicability).toBe("conditional");
  });

  test("propagates constant results through word multiply", () => {
    const source = ["moveq #7,d0", "muls.w #8,d0", "rts"].join("\n");
    const ctx = fixtureContext(source);
    expect(ctx.registers.valueAfter(1, "d0")).toEqual({
      kind: "constant",
      value: 56,
    });
  });
});

describe("v0.13 multiply and disposable-register sequence rules", () => {
  test("offers unsigned word power-of-two multiply replacement and checks CCR liveness", () => {
    const safeSource = ["mulu.w #8,d0", "add.l d1,d2", "rts"].join("\n");
    const safe = lint(safeSource).find(
      (d) => d.ruleId === "optimization/mulu-word-power-of-two",
    );
    expect(safe?.suggestion?.replacement).toBe(
      "\tswap d0\n\tclr.w d0\n\tswap d0\n\tlsl.l #3,d0",
    );
    expect(safe?.suggestion?.applicability).toBe("safe");

    const liveSource = ["mulu.w #8,d0", "bcs .carry", ".carry:", "rts"].join(
      "\n",
    );
    const live = lint(liveSource).find(
      (d) => d.ruleId === "optimization/mulu-word-power-of-two",
    );
    expect(live?.suggestion?.applicability).toBe("conditional");
  });

  test("uses the high-power signed word construction for m=9..15", () => {
    const diagnostic = lint(
      ["muls.w #1024,d3", "move.l d0,d1", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/muls-word-high-power-of-two");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tswap d3\n\tclr.w d3\n\tasr.l #6,d3",
    );
  });

  test("collapses NEG+SUB only when the negated register is disposable", () => {
    const source = [
      "neg.l d0",
      "sub.l d0,d1",
      "move.l #0,d0",
      "add.l d2,d3",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/negate-sub-to-add",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tadd.l d0,d1");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("does not collapse NEG pair if the changed source value is later read", () => {
    const source = ["neg.l d0", "sub.l d0,d1", "move.l d0,d2", "rts"].join(
      "\n",
    );
    expect(ids(source)).not.toContain("optimization/negate-sub-to-add");
  });

  test("collapses NEG+ADD to SUB for a dead source register", () => {
    const source = [
      "neg.w d4",
      "add.w d4,d5",
      "moveq #0,d4",
      "move.l d0,d1",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/negate-add-to-sub",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tsub.w d4,d5");
  });

  // XOR by a mask m maps x to m-x, so the identity pairs with ADD #m, not with
  // the next power of two: neg/add #8 of 3 is 5 where eor #7 of 3 is 4. The
  // rule matched the power of two and emitted the mask, and was off by one.
  test("the NEG/ADD to EOR identity uses the mask, not the power of two above it", () => {
    const mask = ["moveq #3,d0", "neg.l d0", "add.l #7,d0", "rts"].join("\n");
    expect(
      lint(mask).find((d) => d.ruleId === "optimization/negate-add-mask-to-eor")
        ?.suggestion?.replacement,
    ).toBe("\teor.l #7,d0");

    const powerOfTwo = ["moveq #3,d0", "neg.l d0", "add.l #8,d0", "rts"].join(
      "\n",
    );
    expect(ids(powerOfTwo)).not.toContain(
      "optimization/negate-add-mask-to-eor",
    );
  });
});

test("v0.13 uses the high-power unsigned word construction", () => {
  const diagnostic = lint(
    ["mulu.w #2048,d6", "move.l d0,d1", "rts"].join("\n"),
  ).find((d) => d.ruleId === "optimization/mulu-word-high-power-of-two");
  expect(diagnostic?.suggestion?.replacement).toBe(
    "\tswap d6\n\tclr.w d6\n\tlsr.l #5,d6",
  );
});

describe("v0.16 redundant TST and additional ASP68K rules", () => {
  test("removes TST after MOVE when the same register/result size already set equivalent flags", () => {
    const source = [
      "move.w d0,d1",
      "tst.w d1",
      "beq .foo",
      ".foo:",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/redundant-tst",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("does not remove TST after arithmetic when carry is consumed", () => {
    const source = [
      "add.w d0,d1",
      "tst.w d1",
      "bcs .carry",
      ".carry:",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain("optimization/redundant-tst");
  });

  test("does remove TST after arithmetic when only Z is observed", () => {
    const source = [
      "add.w d0,d1",
      "tst.w d1",
      "beq .zero",
      ".zero:",
      "add.l d3,d4",
      "rts",
    ].join("\n");
    expect(ids(source)).toContain("optimization/redundant-tst");
  });

  test("does not remove a labelled TST that may be an alternate entry point", () => {
    const source = [
      "move.w d0,d1",
      ".test:",
      "tst.w d1",
      "beq .zero",
      ".zero:",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain("optimization/redundant-tst");
  });

  test("uses TAS for BSET bit 7 plus BEQ on 68000", () => {
    const source = [
      "bset.b #7,(a0)",
      "beq .clear",
      "move.l d0,d1",
      ".clear:",
      "rts",
    ].join("\n");
    const config = {
      processors: ["mc68000" as const],
      rules: { "optimization/bset-to-tas": "suggestion" as const },
    };
    const diagnostic = lint(source, config).find(
      (d) => d.ruleId === "optimization/bset-to-tas",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\ttas (a0)\n\tbpl .clear",
    );
  });

  test("does not suggest memory TAS form on 68040", () => {
    expect(
      lint("bset.b #7,(a0)", { processors: ["mc68040"] }).map((d) => d.ruleId),
    ).not.toContain("optimization/bset-to-tas");
  });

  test("uses SUBA.L to zero an address register for LEA 0.w", () => {
    const diagnostic = lint("lea 0.w,a2").find(
      (d) => d.ruleId === "optimization/lea-zero-address",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tsuba.l a2,a2");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("also uses SUBA.L to zero an address register for LEA 0.l", () => {
    // Verified with 68kcounter: the .L form is an even bigger win than .W --
    // SUBA.L beats it on both cycles (8 vs 12) and bytes (2 vs 6), not just bytes.
    const diagnostic = lint("lea 0.l,a2").find(
      (d) => d.ruleId === "optimization/lea-zero-address",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tsuba.l a2,a2");
  });

  test("synthesizes selected constants with MOVEQ + NOT.W", () => {
    const diagnostic = lint(
      ["move.l #65534,d0", "move.l d1,d2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/move-immediate-word-complement");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmoveq #1,d0\n\tnot.w d0",
    );
  });

  test("synthesizes selected constants with MOVEQ + SWAP", () => {
    const diagnostic = lint(
      ["move.l #2752512,d0", "move.l d1,d2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/move-immediate-swap");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmoveq #42,d0\n\tswap d0",
    );
  });

  test("does not suggest MOVEQ + SWAP where MOVEQ alone loads the value", () => {
    // SWAP of $ffffffff or 0 is a no-op: optimization/prefer-moveq covers these.
    const diagnostics = lint(
      ["move.l #-1,d3", "move.l #0,d4", "rts"].join("\n"),
    );
    expect(
      diagnostics.filter(
        (d) => d.ruleId === "optimization/move-immediate-swap",
      ),
    ).toEqual([]);
  });
});

// Mnemonic spelling/alias normalization smoke tests are intentionally kept at
// the helper level: every rule using isInstruction() benefits automatically.
import { isInstruction, isInstructionFamily } from "../util/ast.js";
import { canonicalMnemonicName } from "../semantics/mnemonics.js";

describe("mnemonic canonicalisation", () => {
  test("matches semantic mnemonics through source aliases", () => {
    const file = parseFixture("addi.l #1,d0\nadda.l #1,a0");
    expect(isInstruction(file.lines[0], "add")).toBe(true);
    // ADDA is deliberately distinct from ADD: it sets no condition codes.
    expect(isInstruction(file.lines[1], "add")).toBe(false);
    expect(isInstruction(file.lines[1], "adda")).toBe(true);
    // Rules valid across both forms opt into the broader family matcher.
    expect(isInstructionFamily(file.lines[1], "add")).toBe(true);
  });

  test("normalises immediate instruction spellings", () => {
    expect(canonicalMnemonicName("ADDI")).toBe("add");
    expect(canonicalMnemonicName("SUBI")).toBe("sub");
    expect(canonicalMnemonicName("CMPI")).toBe("cmp");
    expect(canonicalMnemonicName("EORI")).toBe("eor");
  });

  test("normalises condition-code aliases", () => {
    expect(canonicalMnemonicName("BHS")).toBe("bcc");
    expect(canonicalMnemonicName("BLO")).toBe("bcs");
    expect(canonicalMnemonicName("DBHS")).toBe("dbcc");
    expect(canonicalMnemonicName("DBLO")).toBe("dbcs");
    expect(canonicalMnemonicName("DBRA")).toBe("dbf");
  });
});

describe("operand-sensitive semantic normalisation", () => {
  test("treats generic ADD to An as ADDA for rules and CCR semantics", () => {
    expect(ids("add.l #100,a0")).toContain("optimization/address-add-to-lea");
    expect(ids("add.l #5,a0")).toContain("optimization/prefer-addq");
  });

  test("treats generic MOVE to An as MOVEA, not flag-setting MOVE", () => {
    expect(ids("move.l #42,a0")).not.toContain("optimization/prefer-moveq");
    expect(ids("move.l #42,a0")).toContain(
      "optimization/prefer-move-word-address",
    );

    const source = ["move.l d0,a0", "beq .foo", ".foo:", "rts"].join("\n");
    expect(ids(source)).toContain("suspicious/stale-condition-code");
  });

  test("does not suggest TST for generic CMP to An", () => {
    expect(ids("cmp.l #0,a0")).not.toContain("optimization/prefer-tst-zero");
  });

  test("treats address-register self MOVE as a removable MOVEA", () => {
    const diagnostic = lint("move.l a0,a0").find(
      (d) => d.ruleId === "suspicious/self-move",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
    expect(diagnostic?.suggestion?.replacement).toBe("");
  });
});

describe("v0.19 long shifts and MOVEA/LEA rules", () => {
  test("replaces ASL.L #16 with SWAP+CLR.W on 68000", () => {
    const diagnostic = lint(
      ["asl.l #16,d0", "add.l d1,d2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/long-shift-sequence");
    expect(diagnostic?.suggestion?.replacement).toBe("\tswap d0\n\tclr.w d0");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("uses the 17..31 arithmetic-right shift sequence", () => {
    const diagnostic = lint(
      ["asr.l #20,d3", "move.l d1,d2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/long-shift-sequence");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tswap d3\n\tasr.w #4,d3\n\text.l d3",
    );
  });

  test("does not offer early-CPU ASL sequence on 68040", () => {
    expect(
      lint("asl.l #16,d0", { processors: ["mc68040"] }).map((d) => d.ruleId),
    ).not.toContain("optimization/long-shift-sequence");
  });

  test("allows the documented LSR #16 sequence on 68030", () => {
    expect(
      lint("lsr.l #16,d0", { processors: ["mc68030"] }).map((d) => d.ruleId),
    ).toContain("optimization/long-shift-sequence");
  });

  test("uses LEA for a non-zero immediate MOVEA", () => {
    // No size suffix: an explicit .L would pin the operand to absolute long and
    // stop the assembler relaxing it to PC-relative.
    const diagnostic = lint("move.l #100,a0").find(
      (d) => d.ruleId === "optimization/movea-immediate-to-lea",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlea 100,a0");
  });

  test("folds MOVEA.L plus immediate ADDA into LEA", () => {
    const source = ["move.l a0,a1", "add.l #12,a1", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/movea-add-to-lea",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlea 12(a0),a1");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("does not fold a word-sized address-register copy into LEA", () => {
    const source = ["move.w a0,a1", "add.w #12,a1", "rts"].join("\n");
    expect(ids(source)).not.toContain("optimization/movea-add-to-lea");
  });

  test("folds MOVEA.L plus ADDQ into LEA", () => {
    const source = ["move.l a0,a1", "addq.w #4,a1", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/movea-add-to-lea",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlea 4(a0),a1");
  });
});

describe("v0.19 multiple predecrement cancellation", () => {
  test("folds ADDQ #6 plus word/long predecrement stores", () => {
    const source = [
      "addq.l #6,a0",
      "move.w d0,-(a0)",
      "move.l d1,-(a0)",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/cancel-multiple-predecrement-moves",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmove.w d0,4(a0)\n\tmove.l d1,(a0)",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("folds ADDQ #6 plus long/word predecrement stores", () => {
    const source = [
      "addq.w #6,a2",
      "move.l d0,-(a2)",
      "move.w d1,-(a2)",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/cancel-multiple-predecrement-moves",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmove.l d0,2(a2)\n\tmove.w d1,(a2)",
    );
  });

  test("rejects a source operand which depends on the adjusted register", () => {
    const source = [
      "addq.l #8,a0",
      "move.l (a0),-(a0)",
      "move.l d1,-(a0)",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain(
      "optimization/cancel-multiple-predecrement-moves",
    );
  });

  test("folds the mirrored SUBQ plus postincrement load, at a fixed negative displacement", () => {
    // Unlike ADDQ+predecrement, the read happens at the decremented address,
    // not An's original value, so the fold needs an explicit displacement
    // rather than collapsing to bare (An). Verified with 68kcounter: still a
    // real cycle win (16->12 on 68000) even though the byte count ties.
    const word = lint(
      ["subq.w #2,a3", "move.w (a3)+,d0", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/cancel-subq-postincrement-move");
    expect(word?.suggestion?.replacement).toBe("\tmove.w -2(a3),d0");
    expect(word?.suggestion?.applicability).toBe("safe");

    const long = lint(
      ["subq.l #4,a4", "move.l (a4)+,d1", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/cancel-subq-postincrement-move");
    expect(long?.suggestion?.replacement).toBe("\tmove.l -4(a4),d1");
  });

  test("rejects a SUBQ/postincrement pair whose destination depends on the adjusted register", () => {
    const source = ["subq.w #2,a3", "move.w (a3)+,(a3)", "rts"].join("\n");
    expect(ids(source)).not.toContain(
      "optimization/cancel-subq-postincrement-move",
    );
  });

  test("does not fold SUBQ against a mismatched postincrement width or register", () => {
    expect(
      ids(["subq.w #2,a3", "move.l (a3)+,d0", "rts"].join("\n")),
    ).not.toContain("optimization/cancel-subq-postincrement-move");
    expect(
      ids(["subq.w #2,a3", "move.w (a4)+,d0", "rts"].join("\n")),
    ).not.toContain("optimization/cancel-subq-postincrement-move");
  });
});

describe("v0.20 coverage rules", () => {
  test("cancels ADDQ #4,SP plus PEA with CCR-aware direct store", () => {
    const safe = lint(
      ["addq.l #4,sp", "pea (a0)", "move.l d0,d1", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/cancel-stack-pea-sequence");
    expect(safe?.suggestion?.replacement).toBe("\tmove.l a0,(sp)");
    expect(safe?.suggestion?.applicability).toBe("safe");

    const escaping = lint(["addq.l #4,sp", "pea (a0)", "rts"].join("\n")).find(
      (d) => d.ruleId === "optimization/cancel-stack-pea-sequence",
    );
    expect(escaping?.suggestion?.applicability).toBe("conditional");
  });

  test("cancels mixed stack predecrement/PEA forms", () => {
    const a = lint(
      ["addq.w #6,sp", "move.w d0,-(sp)", "pea (a1)", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/cancel-stack-pea-sequence");
    expect(a?.suggestion?.replacement).toBe(
      "\tmove.w d0,4(sp)\n\tmove.l a1,(sp)",
    );

    const b = lint(
      ["addq.l #8,sp", "pea (a0)", "move.l d2,-(sp)", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/cancel-stack-pea-sequence");
    expect(b?.suggestion?.replacement).toBe(
      "\tmove.l a0,4(sp)\n\tmove.l d2,(sp)",
    );
    expect(b?.suggestion?.applicability).toBe("safe");
  });

  test("rejects stack-fold source operands that depend on SP", () => {
    expect(
      ids(["addq.w #6,sp", "move.w (sp),-(sp)", "pea (a1)"].join("\n")),
    ).not.toContain("optimization/cancel-stack-pea-sequence");
  });

  test("removes long multiply by one on every 68020+ target and respects CCR", () => {
    const diagnostic = lint(
      ["muls.l #1,d0", "move.l d1,d2", "rts"].join("\n"),
      { processors: ["mc68060"] },
    ).find((d) => d.ruleId === "optimization/multiply-long-by-one");
    expect(diagnostic?.suggestion?.replacement).toBe("");
    expect(diagnostic?.suggestion?.applicability).toBe("safe");

    // MULS.L/MULU.L only exist from 68020 on. Verified with 68kcounter:
    // removing it entirely saves cycles on every target checked -- 68020
    // (50), 68030 (48), 68040 (20), 68060 (3) -- not just 68060.
    for (const cpu of ["mc68020", "mc68030", "mc68040", "mc68060"] as const) {
      expect(
        lint("muls.l #1,d0", { processors: [cpu] }).map((d) => d.ruleId),
      ).toContain("optimization/multiply-long-by-one");
    }
  });
});

describe("v0.22 deferred-rule tranche", () => {
  test("folds MOVEA plus immediate/index ADDA into one LEA", () => {
    const add = lint(
      ["move.l a0,a2", "add.l #12,a2", "add.w d3,a2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/address-expression-to-lea");
    expect(add?.suggestion?.replacement).toBe("\tlea 12(a0,d3.w),a2");
    expect(add?.suggestion?.applicability).toBe("safe");

    const sub = lint(
      ["move.l a1,a4", "sub.w #8,a4", "add.l d5,a4", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/address-expression-to-lea");
    expect(sub?.suggestion?.replacement).toBe("\tlea -8(a1,d5.l),a4");
  });

  test("does not fold MOVEA.W base copies into LEA", () => {
    expect(
      ids(["move.w a0,a2", "add.w #12,a2", "add.w d3,a2"].join("\n")),
    ).not.toContain("optimization/address-expression-to-lea");
  });

  test("folds an address-register index the same way as a data-register index", () => {
    const diagnostic = lint(
      ["move.l a0,a2", "add.l #12,a2", "add.w a3,a2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/address-expression-to-lea");
    expect(diagnostic?.suggestion?.replacement).toBe("\tlea 12(a0,a3.w),a2");
  });

  test("does not fold when the index register is the destination itself", () => {
    const source = ["move.l a0,a2", "add.l #12,a2", "add.w a2,a2", "rts"].join(
      "\n",
    );
    expect(ids(source)).not.toContain("optimization/address-expression-to-lea");
  });

  test("suggests DIVU.W power-of-two shifts conditionally when upper-word use is unknown", () => {
    const diagnostic = lint(["divu.w #8,d0", "rts"].join("\n")).find(
      (d) => d.ruleId === "optimization/divu-word-power-of-two",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tlsr.l #3,d0");
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
    expect(diagnostic?.data?.upperWordUse).toBe("unknown");
  });

  test("can prove DIVU.W shift observation-equivalence when remainder is discarded", () => {
    const diagnostic = lint(
      [
        "moveq #64,d0",
        "divu.w #8,d0",
        "move.w d0,d1",
        "moveq #0,d0",
        "move.l d2,d3",
        "rts",
      ].join("\n"),
    ).find((d) => d.ruleId === "optimization/divu-word-power-of-two");
    expect(diagnostic?.suggestion?.replacement).toBe("\tlsr.l #3,d0");
    expect(diagnostic?.data?.upperWordUse).toBe("unused");
    expect(diagnostic?.data?.quotientOverflowProvenSafe).toBe(true);
  });
});

describe("v0.27 Flamewing shift tranche", () => {
  test("clears known register-count logical shifts once the count reaches the operand width", () => {
    const byte = lint(
      ["moveq #9,d1", "lsl.b d1,d0", "move.l d2,d3", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/known-register-shift-to-clear");
    expect(byte?.suggestion?.replacement).toBe("\tclr.b d0");

    const long = lint(
      ["moveq #32,d1", "lsr.l d1,d0", "move.l d2,d3", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/known-register-shift-to-clear");
    expect(long?.suggestion?.replacement).toBe("\tmoveq #0,d0");
  });

  test("does not treat ASR as a zeroing shift", () => {
    expect(ids(["moveq #32,d1", "asr.l d1,d0"].join("\n"))).not.toContain(
      "optimization/known-register-shift-to-clear",
    );
  });

  test("clears known register-count logical shifts on 68020 too, unlike its 68000-only siblings", () => {
    // Verified with 68kcounter: a register-count LSR.L on 68020's barrel
    // shifter is still a flat 6 cycles against MOVEQ's flat 3 -- half the
    // cost, not a wash -- unlike the ADD/SUBX/SWAP/ROL sibling rules in this
    // file, which specifically trade instructions for cycles on 68000's
    // linear shifter and would lose that trade on a barrel shifter.
    const source = ["moveq #32,d1", "lsr.l d1,d0", "move.l d2,d3", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source, { processors: ["mc68020"] }).find(
      (d) => d.ruleId === "optimization/known-register-shift-to-clear",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tmoveq #0,d0");
  });

  test("recognises Flamewing byte edge-shift identities", () => {
    const lsr = lint(["lsr.b #7,d0", "move.l d1,d2", "rts"].join("\n")).find(
      (d) => d.ruleId === "optimization/lsr-byte-seven",
    );
    expect(lsr?.suggestion?.replacement).toBe(
      "\tadd.b d0,d0\n\tsubx.b d0,d0\n\tneg.b d0",
    );

    const asr = lint(["asr.b #8,d0", "move.l d1,d2", "rts"].join("\n")).find(
      (d) => d.ruleId === "optimization/asr-byte-saturate",
    );
    expect(asr?.suggestion?.replacement).toBe("\tadd.b d0,d0\n\tsubx.b d0,d0");
  });
});

describe("v0.29 Flamewing multiply tranche", () => {
  test("uses verified full-result MULS.W recipes with a dead scratch register", () => {
    const diagnostic = lint(
      ["muls.w #11,d0", "move.l d0,d2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/muls-word-full-result-constants");
    expect(diagnostic?.suggestion?.replacement).toContain("ext.l d0");
    expect(diagnostic?.suggestion?.replacement).toContain("asl.l #2,d0");
    expect(diagnostic?.data?.factor).toBe(11);
  });

  test("supports additional full-result factors from Flamewing", () => {
    for (const factor of [13, 14, 15, 17, 19, 23, 26, 29, 31, 35]) {
      const diagnostic = lint(
        [`muls.w #${factor},d0`, "move.l d0,d2", "rts"].join("\n"),
      ).find(
        (d) => d.ruleId === "optimization/muls-word-full-result-constants",
      );
      expect(diagnostic?.data?.factor).toBe(factor);
    }
  });

  test("uses low-word-only recipes only when the result high word is discarded", () => {
    const safe = lint(
      [
        "muls.w #7,d0",
        "move.w d0,d2",
        "moveq #0,d0",
        "move.l d3,d4",
        "rts",
      ].join("\n"),
    ).find((d) => d.ruleId === "optimization/muls-word-low-word-only");
    expect(safe?.data?.upperWordUse).toBe("unused");

    const used = lint(
      ["muls.w #7,d0", "swap d0", "move.w d0,d2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/muls-word-low-word-only");
    expect(used).toBeUndefined();
  });
});

test("reduces known large register-count ASR to sign saturation", () => {
  const word = lint(
    ["moveq #15,d1", "asr.w d1,d0", "move.l d0,d2", "moveq #0,d1", "rts"].join(
      "\n",
    ),
  ).find((d) => d.ruleId === "optimization/known-register-asr-saturate");
  expect(word?.suggestion?.replacement).toBe("\tadd.w d0,d0\n\tsubx.w d0,d0");

  const long = lint(
    ["moveq #31,d1", "asr.l d1,d0", "move.l d0,d2", "moveq #0,d1", "rts"].join(
      "\n",
    ),
  ).find((d) => d.ruleId === "optimization/known-register-asr-saturate");
  expect(long?.suggestion?.replacement).toBe("\tadd.l d0,d0\n\tsubx.l d0,d0");
});

describe("v0.30 Flamewing partial-register tranche", () => {
  test("uses MOVEQ + AND.B when upper 24 bits are proven discarded", () => {
    const source = [
      "move.b (a0),d0",
      "andi.b #$7f,d0",
      "move.b d0,d1",
      "moveq #0,d0",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/move-byte-and-mask",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmoveq #127,d0\n\tand.b (a0),d0",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("does not use MOVEQ + AND.B when upper bits are subsequently observed", () => {
    const source = [
      "move.b (a0),d0",
      "andi.b #$7f,d0",
      "move.l d0,d1",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain("optimization/move-byte-and-mask");
  });

  test("does not reorder an EA which depends on the destination data register", () => {
    const source = [
      "move.b (a0,d0.w),d0",
      "andi.b #$7f,d0",
      "move.b d0,d1",
      "moveq #0,d0",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain("optimization/move-byte-and-mask");
  });

  test("reduces high known register-count long logical shifts without stack scratch", () => {
    const left = lint(
      [
        "moveq #30,d1",
        "lsl.l d1,d0",
        "move.l d0,d2",
        "moveq #0,d1",
        "rts",
      ].join("\n"),
    ).find((d) => d.ruleId === "optimization/known-register-shift-reduction");
    expect(left?.suggestion?.replacement).toBe(
      "\tror.w #2,d0\n\tandi.w #$C000,d0\n\tswap d0\n\tclr.w d0",
    );

    const right = lint(
      [
        "moveq #29,d1",
        "lsr.l d1,d0",
        "move.l d0,d2",
        "moveq #0,d1",
        "rts",
      ].join("\n"),
    ).find((d) => d.ruleId === "optimization/known-register-shift-reduction");
    expect(right?.suggestion?.replacement).toBe(
      "\tclr.w d0\n\tswap d0\n\tandi.w #$E000,d0\n\trol.w #3,d0",
    );
  });
});

describe("v0.31 Flamewing arithmetic-shift tranche", () => {
  test("uses ASR.W low-word reduction only when the high word is discarded", () => {
    const safe = lint(
      [
        "moveq #12,d1",
        "asr.w d1,d0",
        "move.w d0,d2",
        "moveq #0,d0",
        "moveq #0,d1",
        "rts",
      ].join("\n"),
    ).find((d) => d.ruleId === "optimization/known-register-asr-word-low-only");
    expect(safe?.suggestion?.replacement).toBe(
      "\text.l d0\n\tswap d0\n\trol.l #4,d0",
    );

    const used = lint(
      ["moveq #12,d1", "asr.w d1,d0", "move.l d0,d2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/known-register-asr-word-low-only");
    expect(used).toBeUndefined();
  });

  test("reduces known ASR.L counts 26..30 without stack scratch", () => {
    const diagnostic = lint(
      [
        "moveq #28,d1",
        "asr.l d1,d0",
        "move.l d0,d2",
        "moveq #0,d1",
        "rts",
      ].join("\n"),
    ).find((d) => d.ruleId === "optimization/known-register-asr-long-high");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tswap d0\n\text.l d0\n\tswap d0\n\trol.l #4,d0\n\text.l d0",
    );
  });
});

describe("v0.32 Flamewing unsigned low-word multiply tranche", () => {
  test("uses a word-only MULU recipe when the high word is discarded", () => {
    const diagnostic = lint(
      ["mulu.w #9,d0", "move.w d0,d2", "moveq #0,d0", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/mulu-word-low-word-only");
    expect(diagnostic?.suggestion?.replacement).toContain("lsl.w #3,d0");
    expect(diagnostic?.data?.factor).toBe(9);
  });

  test("does not use a word-only MULU recipe when the high word is observed", () => {
    const diagnostic = lint(
      ["mulu.w #9,d0", "move.l d0,d2", "rts"].join("\n"),
    ).find((d) => d.ruleId === "optimization/mulu-word-low-word-only");
    expect(diagnostic).toBeUndefined();
  });

  test("can remove MULU.W #1 when only the low word and no CCR result are observed", () => {
    const diagnostic = lint(
      [
        "mulu.w #1,d0",
        "move.w d0,d2",
        "moveq #0,d0",
        "move.l d3,d4",
        "rts",
      ].join("\n"),
    ).find((d) => d.ruleId === "optimization/mulu-word-low-word-only");
    expect(diagnostic?.suggestion?.replacement).toBe("");
  });
});

describe("vasm-derived optimizations", () => {
  test("replaces logical identity immediates on data registers with TST", () => {
    const result = lint("andi.w #$ffff,d0\nori.l #0,d1\neori.b #0,d2\n", {
      processors: ["mc68000"],
    });
    expect(
      result.some(
        (d) =>
          d.ruleId === "optimization/andi-all-ones-to-tst" &&
          d.suggestion?.replacement === "\ttst.w d0",
      ),
    ).toBe(true);
    expect(
      result.some(
        (d) =>
          d.ruleId === "optimization/ori-zero-to-tst" &&
          d.suggestion?.replacement === "\ttst.l d1",
      ),
    ).toBe(true);
    expect(
      result.some(
        (d) =>
          d.ruleId === "optimization/eori-zero-to-tst" &&
          d.suggestion?.replacement === "\ttst.b d2",
      ),
    ).toBe(true);
  });

  test("marks memory logical-identity replacement conditional because RMW side effects differ", () => {
    const result = lint("ori.w #0,(a0)\n", { processors: ["mc68000"] });
    const diagnostic = result.find(
      (d) => d.ruleId === "optimization/ori-zero-to-tst",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
  });

  test("narrows signed-word CMPA immediates", () => {
    const result = lint("cmp.l #1234,a0\n", { processors: ["mc68000"] });
    expect(
      result.some(
        (d) =>
          d.ruleId === "optimization/narrow-cmpa-immediate-word" &&
          d.suggestion?.replacement === "\tcmpa.w #1234,a0",
      ),
    ).toBe(true);
  });
});

describe("Flamewing A7 stack-alignment shift by eight", () => {
  test("suggests LSL.W #8 on 68000 as a bounded stack-scratch optimization", () => {
    const result = lint("lsl.w #8,d0\n", { processors: ["mc68000"] });
    const d = result.find(
      (x) => x.ruleId === "optimization/stack-word-shift-eight",
    );
    expect(d).toBeDefined();
    expect(d?.suggestion?.applicability).toBe("conditional");
    expect(d?.suggestion?.replacement).toContain("move.b d0,-(sp)");
    expect(d?.suggestion?.replacement).toContain("move.w (sp)+,d0");
    expect(d?.suggestion?.replacement).toContain("clr.b d0");
  });

  test("suggests LSR.W #8 on 68000 as a manual stack-scratch optimization", () => {
    const result = lint("lsr.w #8,d2\n", { processors: ["mc68000"] });
    const d = result.find(
      (x) => x.ruleId === "optimization/stack-word-shift-eight",
    );
    expect(d).toBeDefined();
    expect(d?.suggestion?.replacement).toContain("move.w d2,-(sp)");
    expect(d?.suggestion?.replacement).toContain("move.b (sp)+,d2");
  });

  test("does not offer the 68000 stack trick on later-only targets", () => {
    const result = lint("lsl.w #8,d0\n", { processors: ["mc68020"] });
    expect(
      result.some((x) => x.ruleId === "optimization/stack-word-shift-eight"),
    ).toBe(false);
  });
});

describe("Flamewing bounded A7 stack-scratch shifts", () => {
  test("suggests ASR.W #8 using two temporary stack bytes", () => {
    const result = lint("asr.w #8,d0\n", { processors: ["mc68000"] });
    const d = result.find(
      (x) => x.ruleId === "optimization/stack-word-shift-eight",
    );
    expect(d).toBeDefined();
    expect(d?.suggestion?.replacement).toBe(
      "\tmove.w d0,-(sp)\n\tmove.b (sp)+,d0\n\text.w d0",
    );
    expect(d?.suggestion?.applicability).toBe("conditional");
  });

  test("replaces MOVEQ #9 + LSL.W with the bounded stack form when the count register is disposable", () => {
    const result = lint(
      "moveq #9,d1\nlsl.w d1,d0\nmove.w d0,d2\nmoveq #0,d1\n",
      { processors: ["mc68000"] },
    );
    const d = result.find(
      (x) => x.ruleId === "optimization/stack-known-register-shift",
    );
    expect(d).toBeDefined();
    expect(d?.suggestion?.replacement).toContain("move.b d0,-(sp)");
    expect(d?.suggestion?.replacement).toContain("add.w d0,d0");
  });

  test("suggests the stack-assisted LSL.L #24 known-count sequence", () => {
    const result = lint(
      "moveq #24,d1\nlsl.l d1,d0\nmove.l d0,d2\nmoveq #0,d1\n",
      { processors: ["mc68000"] },
    );
    const d = result.find(
      (x) => x.ruleId === "optimization/stack-known-register-shift",
    );
    expect(d).toBeDefined();
    expect(d?.suggestion?.replacement).toContain("swap d0");
    expect(d?.suggestion?.replacement).toContain("clr.w d0");
  });

  test("suggests the stack-assisted LSR.L #24 known-count sequence", () => {
    const result = lint(
      "moveq #24,d1\nlsr.l d1,d0\nmove.l d0,d2\nmoveq #0,d1\n",
      { processors: ["mc68000"] },
    );
    const d = result.find(
      (x) => x.ruleId === "optimization/stack-known-register-shift",
    );
    expect(d).toBeDefined();
    expect(d?.suggestion?.replacement).toContain("move.w d0,-(sp)");
    expect(d?.suggestion?.replacement).toContain("move.b (sp)+,d0");
  });

  test("does not remove a live count register setup", () => {
    const result = lint("moveq #24,d1\nlsl.l d1,d0\nmove.l d1,d2\n", {
      processors: ["mc68000"],
    });
    expect(
      result.some(
        (x) => x.ruleId === "optimization/stack-known-register-shift",
      ),
    ).toBe(false);
  });
});

describe("v0.37 vasm source + optimization goals", () => {
  test("replaces negative power-of-two long MULS using shift plus NEG", () => {
    const diagnostic = lint("muls.l #-8,d0\nmove.l d0,d1\n", {
      processors: ["mc68020"],
    }).find((d) => d.ruleId === "optimization/negative-signed-multiply");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tasl.l #3,d0\n\tneg.l d0",
    );
  });

  test("replaces MULS.W #-1 with EXT.L plus NEG.L", () => {
    const diagnostic = lint("muls.w #-1,d0\nmove.l d0,d1\n", {
      processors: ["mc68000"],
    }).find((d) => d.ruleId === "optimization/negative-signed-multiply");
    expect(diagnostic?.suggestion?.replacement).toBe("\text.l d0\n\tneg.l d0");
  });

  test("size goal suppresses speed-for-size rules but balanced retains them", () => {
    const source = "muls.l #-8,d0\nmove.l d0,d1\n";
    expect(
      lint(source, { processors: ["mc68020"], goal: "balanced" }).some(
        (d) => d.ruleId === "optimization/negative-signed-multiply",
      ),
    ).toBe(true);
    expect(
      lint(source, { processors: ["mc68020"], goal: "size" }).some(
        (d) => d.ruleId === "optimization/negative-signed-multiply",
      ),
    ).toBe(false);
  });
});

describe("MOVEA immediate to LEA", () => {
  const cfg = { processors: ["mc68000" as const], measureImpact: false };
  const ID = "optimization/movea-immediate-to-lea";
  const rep = (source: string, config: LintConfig = cfg) =>
    lint(source, config).find((d) => d.ruleId === ID)?.suggestion?.replacement;

  test("covers both a folded constant and a link-time symbol", () => {
    // Anything loaded into an address register is an address either way.
    expect(rep("move.l #100,a0")).toBe("\tlea 100,a0");
    expect(rep("move.l #label,a0\nlabel:\nrts")).toBe("\tlea label,a0");
    expect(rep("SCREEN equ $10000\nmove.l #SCREEN,a0")).toBe("\tlea SCREEN,a0");
    expect(rep("movea.l #label,a1\nlabel:\nrts")).toBe("\tlea label,a1");
    expect(rep("move.l #label+8,a2\nlabel:\nrts")).toBe("\tlea label+8,a2");
  });

  test("emits no size suffix for .L, so the assembler can relax to PC-relative", () => {
    // An explicit .L would pin the operand to absolute long and defeat the
    // relaxation, which is the whole point.
    expect(rep("move.l #label,a0\nlabel:\nrts")).not.toContain(".l");
  });

  test("keeps the .W suffix, because MOVEA.W sign-extends", () => {
    // Without it the assembler could pick absolute long and turn #$8000 into
    // $00008000 rather than $FFFF8000.
    expect(rep("movea.w #$7000,a0")).toBe("\tlea $7000.w,a0");
  });

  test("is not gated to early CPUs", () => {
    // The 68000/68010 gate existed for an ASP68K speed claim that exact
    // auditing does not bear out: the two forms measure identically.
    const later = {
      processors: ["mc68020" as const],
      measureImpact: false,
    } as LintConfig;
    expect(rep("move.l #100,a0", later)).toBe("\tlea 100,a0");
    expect(rep("SCREEN equ $10000\nmove.l #SCREEN,a0", later)).toBe(
      "\tlea SCREEN,a0",
    );
  });

  test("leaves zero to the rules that specialise in it", () => {
    expect(ids("move.l #0,a0", cfg)).not.toContain(ID);
    expect(ids("move.l #0,a0", cfg)).toContain(
      "optimization/zero-address-register",
    );
  });

  test("is measured as neutral, because the gain is realised by the assembler", () => {
    const diagnostic = lint("move.l #label,a0\nlabel:\nrts", {
      processors: ["mc68000"],
    }).find((d) => d.ruleId === ID);
    expect(diagnostic?.suggestion?.impact?.assessment).toBe("neutral");
  });
});

describe("platform modes", () => {
  test("TAS optimization is disabled by default", () => {
    const source = ["bset.b #7,(a0)", "moveq #0,d7"].join("\n");
    expect(lint(source).map((d) => d.ruleId)).not.toContain(
      "optimization/bset-to-tas",
    );
  });

  test("TAS optimization can still be explicitly enabled", () => {
    const source = ["bset.b #7,(a0)", "moveq #0,d7"].join("\n");
    const result = lint(source, {
      processors: ["mc68000"],
      platform: "generic",
      goal: "balanced",
      measureImpact: false,
      rules: { "optimization/bset-to-tas": "suggestion" },
    });
    expect(result.map((d) => d.ruleId)).toContain("optimization/bset-to-tas");
  });

  test("Amiga mode accepts TAS on a data register", () => {
    // The problem is the locked read-modify-write cycle used to reach memory.
    // TAS Dn performs no memory access, so it is safe.
    expect(
      lint("tas d0", {
        processors: ["mc68000"],
        platform: "amiga",
        goal: "balanced",
        measureImpact: false,
      }).map((d) => d.ruleId),
    ).not.toContain("correctness/amiga-tas-unsupported");
  });

  test("Amiga mode rejects TAS instructions", () => {
    expect(
      lint("tas (a0)", {
        processors: ["mc68000"],
        platform: "amiga",
        goal: "balanced",
        measureImpact: false,
      }).map((d) => d.ruleId),
    ).toContain("correctness/amiga-tas-unsupported");

    expect(
      lint("tas (a0)", {
        processors: ["mc68000"],
        platform: "generic",
        goal: "balanced",
        measureImpact: false,
      }).map((d) => d.ruleId),
    ).not.toContain("correctness/amiga-tas-unsupported");
  });

  test("Amiga mode checks custom-register access direction", () => {
    const config = {
      processors: ["mc68000"],
      platform: "amiga",
      goal: "balanced",
      measureImpact: false,
    } as LintConfig;
    expect(lint("move.w #1,$dff002", config).map((d) => d.ruleId)).toContain(
      "correctness/amiga-custom-register-access",
    );
    expect(lint("move.w $dff09a,d0", config).map((d) => d.ruleId)).toContain(
      "correctness/amiga-custom-register-access",
    );
    expect(
      lint("move.w $dff002,d0", config).map((d) => d.ruleId),
    ).not.toContain("correctness/amiga-custom-register-access");
    expect(
      lint("move.w d0,$dff09a", config).map((d) => d.ruleId),
    ).not.toContain("correctness/amiga-custom-register-access");

    // Canonical Amiga include style: register symbols are offsets from CUSTOM.
    expect(
      lint("    lea CUSTOM,a6\n    move.w DMACON(a6),d0\n", config).map(
        (d) => d.ruleId,
      ),
    ).toContain("correctness/amiga-custom-register-access");
    expect(
      lint("    lea custom,a6\n    move.w d0,dmaconr(a6)\n", config).map(
        (d) => d.ruleId,
      ),
    ).toContain("correctness/amiga-custom-register-access");

    // Absolute expressions combining a register offset with the CUSTOM base.
    expect(
      lint("    move.w DMACON+CUSTOM,d0\n", config).map((d) => d.ruleId),
    ).toContain("correctness/amiga-custom-register-access");
    expect(
      lint("    move.w d0,DMACONR+CUSTOM\n", config).map((d) => d.ruleId),
    ).toContain("correctness/amiga-custom-register-access");
    expect(
      lint("    move.w DMACONR+CUSTOM,d0\n", config).map((d) => d.ruleId),
    ).not.toContain("correctness/amiga-custom-register-access");
  });
});

describe("rules mined from the EAB thread", () => {
  const cfg = { processors: ["mc68000" as const], measureImpact: false };
  const rep = (source: string, id: string) =>
    lint(source, cfg).find((d) => d.ruleId === id)?.suggestion?.replacement;

  describe("mask via MOVEQ", () => {
    const ID = "optimization/mask-via-moveq";

    test("swaps a load-then-mask for a MOVEQ seed plus AND", () => {
      // The mask keeps the hex the author wrote rather than becoming 63.
      expect(rep("move.l (a0),d0\nand.l #$3f,d0\nmoveq #0,d7\nrts", ID)).toBe(
        "\tmoveq #$3f,d0\n\tand.l (a0),d0",
      );
    });

    test("only when the mask fits MOVEQ, or the seed needs its own extension word", () => {
      expect(ids("move.l (a0),d0\nand.l #$3fff,d0\nrts", cfg)).not.toContain(
        ID,
      );
    });

    test("leaves a source with side effects alone", () => {
      // (a0)+ cannot be read a second time in the AND's place.
      expect(ids("move.l (a0)+,d0\nand.l #$3f,d0\nrts", cfg)).not.toContain(ID);
    });

    test("also accepts a fixed displacement source", () => {
      // 4(a0) has no side effects and doesn't depend on the loaded register,
      // so it is just as re-readable as (a0) or an absolute address.
      expect(rep("move.l 4(a0),d0\nand.l #$3f,d0\nmoveq #0,d7\nrts", ID)).toBe(
        "\tmoveq #$3f,d0\n\tand.l 4(a0),d0",
      );
    });
  });

  describe("sign bit to TAS", () => {
    const ID = "optimization/data-register-sign-bit-to-tas";

    test("covers both spellings that set bit 7", () => {
      expect(rep("bset #7,d0\nmoveq #0,d7\nrts", ID)).toBe("\ttas d0");
      expect(rep("ori.b #$80,d0\nmoveq #0,d7\nrts", ID)).toBe("\ttas d0");
    });

    test("only bit 7, and only a data register", () => {
      expect(ids("bset #6,d0\nrts", cfg)).not.toContain(ID);
      // The memory form is the other rule's business, and is off by default
      // because of the locked read-modify-write cycle.
      expect(ids("bset #7,(a0)\nrts", cfg)).not.toContain(ID);
    });
  });

  describe("carry to mask via SUBX", () => {
    const ID = "optimization/carry-to-mask-via-subx";

    test("collapses SCS plus two extensions", () => {
      expect(
        rep("sub.l d2,d3\nscs d0\next.w d0\next.l d0\nmoveq #0,d7\nrts", ID),
      ).toBe("\tsubx.l d0,d0");
    });

    test("declines after CMP, which leaves X stale", () => {
      // SCS reads C, SUBX reads X. CMP sets C without touching X, so the two
      // disagree and the substitution would use whatever X held before.
      expect(
        ids("cmp.l d2,d3\nscs d0\next.w d0\next.l d0\nrts", cfg),
      ).not.toContain(ID);
    });

    test("needs the whole sequence on one register", () => {
      expect(ids("sub.l d2,d3\nscs d0\next.w d0\nrts", cfg)).not.toContain(ID);
      expect(
        ids("sub.l d2,d3\nscs d0\next.w d1\next.l d1\nrts", cfg),
      ).not.toContain(ID);
    });
  });

  describe("arithmetic immediate via a scratch register", () => {
    const ID = "optimization/arithmetic-immediate-via-scratch";

    test("routes a MOVEQ-sized immediate through a dead register", () => {
      expect(rep("add.l #20,d1\nmoveq #0,d0\nmove.l d1,d2\nrts", ID)).toBe(
        "\tmoveq #20,d0\n\tadd.l d0,d1",
      );
      expect(rep("sub.l #-100,d1\nmoveq #0,d0\nmove.l d1,d2\nrts", ID)).toBe(
        "\tmoveq #-100,d0\n\tsub.l d0,d1",
      );
    });

    test("leaves the quick range to ADDQ and SUBQ", () => {
      expect(ids("add.l #4,d1\nmoveq #0,d0\nrts", cfg)).not.toContain(ID);
      expect(ids("add.l #4,d1\nmoveq #0,d0\nrts", cfg)).toContain(
        "optimization/prefer-addq",
      );
    });

    test("needs a value MOVEQ can hold and a register to spare", () => {
      expect(ids("add.l #1000,d1\nmoveq #0,d0\nrts", cfg)).not.toContain(ID);
      expect(ids("add.l #20,d1\nrts", cfg)).not.toContain(ID);
    });

    test("also routes AND/OR/EOR, which have no quick-immediate form to defer to", () => {
      // Verified with 68kcounter: unlike ADD/SUB, AND/OR/EOR benefit at any
      // magnitude in the MOVEQ range -- #1 shows the same win as #100, so
      // there's no small-value cutoff to leave to a dedicated quick form.
      expect(rep("and.l #1,d1\nmoveq #0,d0\nmove.l d1,d2\nrts", ID)).toBe(
        "\tmoveq #1,d0\n\tand.l d0,d1",
      );
      expect(rep("or.l #100,d1\nmoveq #0,d0\nmove.l d1,d2\nrts", ID)).toBe(
        "\tmoveq #100,d0\n\tor.l d0,d1",
      );
      expect(rep("eor.l #-50,d1\nmoveq #0,d0\nmove.l d1,d2\nrts", ID)).toBe(
        "\tmoveq #-50,d0\n\teor.l d0,d1",
      );
    });
  });

  describe("fold an index into the effective address", () => {
    const ID = "optimization/fold-index-into-effective-address";

    test("folds the addition into the indexed mode", () => {
      expect(
        rep("adda.w d4,a0\nmove.l (a0),a1\nlea buf,a0\nrts\nbuf:", ID),
      ).toBe("\tmove.l (a0,d4.w),a1");
      expect(
        rep("adda.l d4,a0\nmove.l (a0),a1\nlea buf,a0\nrts\nbuf:", ID),
      ).toBe("\tmove.l (a0,d4.l),a1");
    });

    test("works for any instruction that dereferences the register", () => {
      expect(rep("adda.w d4,a0\ntst.w (a0)\nlea buf,a0\nrts\nbuf:", ID)).toBe(
        "\ttst.w (a0,d4.w)",
      );
    });

    test("carries a fixed displacement into the indexed mode", () => {
      expect(
        rep("adda.w d4,a0\nmove.l 4(a0),a1\nlea buf,a0\nrts\nbuf:", ID),
      ).toBe("\tmove.l 4(a0,d4.w),a1");
    });

    test("is offered only where the indexed mode is the faster form", () => {
      // The 68020 and 68040 prefer the address precomputed into the register.
      const src = "adda.w d4,a0\nmove.l (a0),a1\nlea buf,a0\nrts\nbuf:";
      for (const cpu of ["mc68020", "mc68040"] as const) {
        expect([
          cpu,
          ids(src, { processors: [cpu], measureImpact: false }).includes(ID),
        ]).toEqual([cpu, false]);
      }
      for (const cpu of ["mc68000", "mc68010", "mc68060"] as const) {
        expect([
          cpu,
          ids(src, { processors: [cpu], measureImpact: false }).includes(ID),
        ]).toEqual([cpu, true]);
      }
    });

    test("declines when the adjusted register is still needed", () => {
      // The fold leaves the base unchanged, so a later read would differ.
      expect(
        ids("adda.w d4,a0\nmove.l (a0),a1\nmove.l a0,d3\nrts", cfg),
      ).not.toContain(ID);
      // Unknown at a return counts as still needed.
      expect(ids("adda.w d4,a0\nmove.l (a0),a1\nrts", cfg)).not.toContain(ID);
    });
  });
});

describe("register semantics", () => {
  test("postincrement and predecrement update their address register", () => {
    // Without this the value analysis believed the pointer still held its
    // pre-increment value, which would misresolve any rule reading it.
    const stepped = (source: string) =>
      fixtureContext(source).registers.knownConstantBefore(2, "a2");

    expect(
      stepped("lea $1000,a2\nmove.w (a2)+,d1\nmove.l a2,d3\nrts"),
    ).toBeUndefined();
    expect(
      stepped("lea $1000,a2\nmove.w -(a2),d1\nmove.l a2,d3\nrts"),
    ).toBeUndefined();
    expect(
      stepped("lea $1000,a2\nmove.w d1,(a2)+\nmove.l a2,d3\nrts"),
    ).toBeUndefined();
    // A plain indirect does not move the pointer, so the value survives.
    expect(stepped("lea $1000,a2\nmove.w (a2),d1\nmove.l a2,d3\nrts")).toBe(
      0x1000,
    );
  });
});

describe("dead register write", () => {
  const cfg = { processors: ["mc68000" as const], measureImpact: false };
  const ID = "suspicious/dead-register-write";
  const lines = (source: string[]) =>
    lint(source.join("\n"), cfg)
      .filter((d) => d.ruleId === ID)
      .map((d) => d.loc.line);

  test("flags a write that is overwritten before anything reads it", () => {
    expect(
      lines([
        "move.w d0,d1",
        "move.w d2,d1",
        "move.w d1,foo(a0)",
        "moveq #0,d7",
        "rts",
      ]),
    ).toEqual([1]);
  });

  test("says nothing when the value is read in between", () => {
    expect(
      lines([
        "move.w d0,d1",
        "move.w d1,foo(a0)",
        "move.w d2,d1",
        "move.w d1,bar(a0)",
        "rts",
      ]),
    ).toEqual([]);
  });

  test("covers other single-register writes", () => {
    expect(
      lines([
        "moveq #5,d3",
        "moveq #7,d3",
        "move.l d3,(a0)",
        "moveq #0,d7",
        "rts",
      ]),
    ).toEqual([1]);
    // LEA never dereferences, so its operand cannot carry a side effect.
    expect(
      lines([
        "lea buf,a1",
        "lea other,a1",
        "move.l (a1),d0",
        "moveq #0,d7",
        "rts",
        "buf:",
        "other:",
      ]),
    ).toEqual([1]);
  });

  test("keeps an instruction whose flags are still needed", () => {
    expect(
      lines([
        "move.w d0,d1",
        "beq .x",
        "move.w d2,d1",
        ".x:",
        "move.w d1,(a0)",
        "moveq #0,d7",
        "rts",
      ]),
    ).toEqual([]);
    // ADD sets X, which MOVEQ does not overwrite, so it escapes to the return.
    expect(
      lines([
        "add.l d0,d1",
        "moveq #7,d1",
        "move.l d1,(a0)",
        "moveq #0,d7",
        "rts",
      ]),
    ).toEqual([]);
    // With X overwritten too, the dead computation can go.
    expect(
      lines([
        "add.l d0,d1",
        "moveq #7,d1",
        "move.l d1,(a0)",
        "add.l d5,d6",
        "rts",
      ]),
    ).toEqual([1]);
  });

  test("reports a dead load but never offers it as a safe removal", () => {
    // The address may be a register that changes state when read, so the
    // removal is for a human to judge.
    const source = [
      "move.w (a2),d1",
      "move.w d2,d1",
      "move.w d1,(a0)",
      "moveq #0,d7",
      "rts",
    ].join("\n");
    const diagnostic = lint(source, cfg).find((d) => d.ruleId === ID);
    expect(diagnostic?.suggestion?.applicability).toBe("manual");
    expect(diagnostic?.suggestion?.replacement).toBeUndefined();
    expect(
      diagnostic?.notes?.some((n) =>
        n.message.includes("changes state when read"),
      ),
    ).toBe(true);
  });

  test("offers a plain removal where no memory is touched", () => {
    const source = [
      "move.w d0,d1",
      "move.w d2,d1",
      "move.w d1,(a0)",
      "moveq #0,d7",
      "rts",
    ].join("\n");
    const diagnostic = lint(source, cfg).find((d) => d.ruleId === ID);
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
    expect(diagnostic?.suggestion?.replacement).toBe("");
  });

  test("leaves a stepped pointer alone", () => {
    // Postincrement and predecrement write their address register too, so the
    // single-register check excludes them: removing one would stop the pointer
    // advancing.
    expect(
      lines([
        "move.w (a2)+,d1",
        "move.w d2,d1",
        "move.w d1,(a0)",
        "moveq #0,d7",
        "rts",
      ]),
    ).toEqual([]);
    expect(
      lines([
        "move.w -(a2),d1",
        "move.w d2,d1",
        "move.w d1,(a0)",
        "moveq #0,d7",
        "rts",
      ]),
    ).toEqual([]);
  });

  test("does not cover dead stores to memory", () => {
    // That needs alias analysis, which this does not have.
    expect(lines(["move.w d0,(a0)", "move.w d2,(a0)", "rts"])).toEqual([]);
  });
});

describe("MOVEM save and restore mismatch", () => {
  const cfg = { processors: ["mc68000" as const], measureImpact: false };
  const ID = "suspicious/movem-restore-mismatch";
  const find = (lines: string[]) =>
    lint(lines.join("\n"), cfg).find((d) => d.ruleId === ID);
  const flags = (lines: string[]) => find(lines) !== undefined;

  test("accepts a matching save and restore", () => {
    expect(
      flags([
        "movem.l d0-d7/a0-a6,-(sp)",
        "nop",
        "movem.l (sp)+,d0-d7/a0-a6",
        "rts",
      ]),
    ).toBe(false);
  });

  test("names the register that goes missing", () => {
    const diagnostic = find([
      "movem.l d0-d7/a0-a6,-(sp)",
      "nop",
      "movem.l (sp)+,d0-d7/a0-a5",
      "rts",
    ]);
    expect(diagnostic?.message).toContain(
      "saves d0-d7/a0-a6 but restores d0-d7/a0-a5",
    );
    expect(diagnostic?.message).toContain("a6 saved but not restored");
    expect(diagnostic?.notes?.[0]?.message).toContain(
      "stack pointer is left unbalanced",
    );
  });

  test("catches a restore of a register that was never saved", () => {
    expect(
      find(["movem.l d0-d3,-(sp)", "movem.l (sp)+,d0-d4", "rts"])?.message,
    ).toContain("d4 restored but not saved");
  });

  test("catches a swap that keeps the stack balanced", () => {
    // Same count, so the stack survives and only the values are wrong, which is
    // the harder version to find by hand.
    const diagnostic = find([
      "movem.l d0-d3,-(sp)",
      "movem.l (sp)+,d0-d2/a0",
      "rts",
    ]);
    expect(diagnostic?.message).toContain("d3 saved but not restored");
    expect(diagnostic?.message).toContain("a0 restored but not saved");
    expect(diagnostic?.notes?.[0]?.message).toContain(
      "registers take each other's values",
    );
  });

  test("catches a size mismatch even when the registers agree", () => {
    expect(
      find(["movem.l d0-d3,-(sp)", "movem.w (sp)+,d0-d3", "rts"])?.message,
    ).toContain("saved as .l but restored as .w");
  });

  test("handles nested saves", () => {
    expect(
      flags([
        "movem.l d0-d1,-(sp)",
        "movem.l a0-a1,-(sp)",
        "movem.l (sp)+,a0-a1",
        "movem.l (sp)+,d0-d1",
        "rts",
      ]),
    ).toBe(false);
  });

  test("stays quiet where pairing is not knowable", () => {
    // A second exit restores the same save, so by then there is nothing pending.
    expect(
      flags([
        "movem.l d0-d3,-(sp)",
        "beq .e",
        "movem.l (sp)+,d0-d3",
        "rts",
        ".e:",
        "movem.l (sp)+,d0-d3",
        "rts",
      ]),
    ).toBe(false);
    // A restore with no visible save cannot be checked.
    expect(flags(["movem.l (sp)+,d0-d3", "rts"])).toBe(false);
  });

  test("does not carry one routine's save into the next", () => {
    expect(
      flags([
        "movem.l d0-d3,-(sp)",
        "movem.l (sp)+,d0-d3",
        "rts",
        "second:",
        "movem.l d0-d7,-(sp)",
        "movem.l (sp)+,d0-d7",
        "rts",
      ]),
    ).toBe(false);
  });

  test("covers a stack held in another address register", () => {
    expect(
      find(["movem.l d0-d3,-(a3)", "nop", "movem.l (a3)+,d0-d2", "rts"])
        ?.message,
    ).toContain("d3 saved but not restored");
  });

  test("covers the single-register spelling", () => {
    expect(
      find(["movem.l d0,-(sp)", "movem.l (sp)+,d1", "rts"])?.message,
    ).toContain("saves d0 but restores d1");
  });

  test("points at the matching save", () => {
    const diagnostic = find([
      "nop",
      "movem.l d0-d3,-(sp)",
      "nop",
      "movem.l (sp)+,d0-d2",
      "rts",
    ]);
    expect(diagnostic?.notes?.[1]?.message).toBe(
      "The matching save is on line 2.",
    );
  });
});

describe("Amiga DMAB_/DMAF_ and INTB_/INTF_ constant misuse", () => {
  const amiga = {
    processors: ["mc68000"],
    platform: "amiga",
    measureImpact: false,
  } as LintConfig;
  const ID = "correctness/amiga-bit-mask-constant";
  const base = "    lea CUSTOM,a6\n";
  const find = (source: string) =>
    lint(base + source, amiga).find((d) => d.ruleId === ID);
  const flags = (source: string) => find(source) !== undefined;

  test("accepts correctly paired constants", () => {
    expect(
      flags("    move.w #DMAF_SETCLR!DMAF_MASTER!DMAF_COPPER,dmacon(a6)"),
    ).toBe(false);
    expect(flags("    move.w #INTF_SETCLR!INTF_VERTB,intena(a6)")).toBe(false);
    expect(flags("    btst #INTB_VERTB,intreqr+1(a6)")).toBe(false);
  });

  test("catches one wrong constant in an ORed list, with either operator", () => {
    const bang = find(
      "    move.w #DMAF_SETCLR!DMAB_MASTER!DMAF_COPPER,dmacon(a6)",
    );
    expect(bang?.message).toContain("DMAB_MASTER");
    expect(bang?.suggestion?.replacement).toBe(
      "    move.w #DMAF_SETCLR!DMAF_MASTER!DMAF_COPPER,dmacon(a6)",
    );

    const pipe = find("    move.w #DMAF_SETCLR|DMAB_BLITTER,dmacon(a6)");
    expect(pipe?.suggestion?.replacement).toBe(
      "    move.w #DMAF_SETCLR|DMAF_BLITTER,dmacon(a6)",
    );
  });

  test("catches a mask used where a bit number is required", () => {
    // The register is reached as a byte at intreqr+1, which still names INTREQR.
    const diagnostic = find("    btst #INTF_VERTB,intreqr+1(a6)");
    expect(diagnostic?.message).toContain("INTREQR");
    expect(diagnostic?.suggestion?.replacement).toBe(
      "    btst #INTB_VERTB,intreqr+1(a6)",
    );
  });

  test("catches the wrong family for the register", () => {
    const diagnostic = find("    move.w #DMAF_SETCLR!INTF_COPER,dmacon(a6)");
    expect(diagnostic?.message).toContain("INTF_COPER");
    // No rename is offered: there is no DMA equivalent of an interrupt name.
    expect(diagnostic?.suggestion?.replacement).toBeUndefined();
  });

  test("works through absolute addresses as well as the CUSTOM base", () => {
    expect(
      lint("    move.w #DMAF_SETCLR!DMAB_COPPER,$dff096", amiga).find(
        (d) => d.ruleId === ID,
      )?.suggestion?.replacement,
    ).toBe("    move.w #DMAF_SETCLR!DMAF_COPPER,$dff096");
  });

  test("uses the majority when no register is resolvable", () => {
    const diagnostic = lint(
      "    move.w #DMAF_SETCLR!DMAB_MASTER!DMAF_COPPER,d0",
      amiga,
    ).find((d) => d.ruleId === ID);
    expect(diagnostic?.message).toContain("DMAB_MASTER");
  });

  test("leaves a lone bit number in a register alone", () => {
    // Loading a bit number for a later BTST is legitimate.
    expect(
      lint("    moveq #DMAB_COPPER,d0", amiga).some((d) => d.ruleId === ID),
    ).toBe(false);
    expect(
      lint("    move.w #FOO!BAR,$dff096", amiga).some((d) => d.ruleId === ID),
    ).toBe(false);
  });
});

describe("Amiga custom-register direction table", () => {
  const amiga = {
    processors: ["mc68000"],
    platform: "amiga",
    measureImpact: false,
  } as LintConfig;
  const ID = "correctness/amiga-custom-register-access";
  const flags = (source: string) => ids(source, amiga).includes(ID);

  test("catches the classic readable-mirror confusions", () => {
    // Each of these has a separate read address; using the write one is a bug.
    for (const [writeOnly, readable] of [
      ["$dff096", "$dff002"], // DMACON  / DMACONR
      ["$dff09a", "$dff01c"], // INTENA  / INTENAR
      ["$dff09c", "$dff01e"], // INTREQ  / INTREQR
      ["$dff09e", "$dff010"], // ADKCON  / ADKCONR
      ["$dff034", "$dff016"], // POTGO   / POTGOR
    ]) {
      expect([writeOnly, flags(`move.w ${writeOnly},d0`)]).toEqual([
        writeOnly,
        true,
      ]);
      expect([readable, flags(`move.w ${readable},d0`)]).toEqual([
        readable,
        false,
      ]);
    }
  });

  test("covers the generated register families", () => {
    for (const address of [
      "$dff0a0", // AUD0LCH
      "$dff0da", // AUD3DAT
      "$dff0e0", // BPL1PTH
      "$dff11a", // BPL6DAT
      "$dff120", // SPR0PTH
      "$dff17e", // SPR7DATB
      "$dff180", // COLOR00
      "$dff1be", // COLOR31
    ]) {
      expect([address, flags(`move.w ${address},d0`)]).toEqual([address, true]);
      expect([address, flags(`move.w #0,${address}`)]).toEqual([
        address,
        false,
      ]);
    }
  });

  test("resolves the added registers through the CUSTOM base convention", () => {
    expect(flags("    lea CUSTOM,a6\n    move.w COLOR00(a6),d0")).toBe(true);
    expect(flags("    lea CUSTOM,a6\n    move.w #0,COLOR00(a6)")).toBe(false);
  });

  test("stays silent on the deliberately omitted ECS/AGA sync block", () => {
    // $1C0-$1FE mixes directions and varies by chipset, so it is not tabulated.
    // Omission must produce no diagnostic rather than a guess.
    expect(flags("move.w $dff1c0,d0")).toBe(false);
    expect(flags("move.w #0,$dff1c0")).toBe(false);
  });
});

describe("Atari TOS trap stack cleanup", () => {
  const atari = {
    processors: ["mc68000"],
    platform: "atari",
    measureImpact: false,
  } as LintConfig;
  const ID = "suspicious/atari-trap-stack-cleanup";
  const flags = (source: string) => ids(source, atari).includes(ID);

  // Cconws: pea (4) plus the opcode word (2).
  const cconws = ["pea msg", "move.w #9,-(sp)", "trap #1"];
  const tail = ["rts", "msg:", "dc.b 0"];
  const call = (...cleanup: string[]) =>
    [...cconws, ...cleanup, ...tail].join("\n");

  test("accepts a matching cleanup", () => {
    expect(flags(call("addq.l #6,sp"))).toBe(false);
    expect(flags(call("add.l #6,sp"))).toBe(false);
    expect(flags(call("lea 6(sp),sp"))).toBe(false);
  });

  test("flags a missing cleanup", () => {
    expect(flags(call())).toBe(true);
  });

  test("flags a cleanup of the wrong size, and says both numbers", () => {
    const diagnostic = lint(call("addq.l #4,sp"), atari).find(
      (d) => d.ruleId === ID,
    );
    expect(diagnostic?.message).toContain("6 bytes are pushed");
    expect(diagnostic?.message).toContain("4 bytes are removed");
    expect(diagnostic?.data?.pushedBytes).toBe(6);
    expect(diagnostic?.data?.releasedBytes).toBe(4);
  });

  test("counts a byte push as two, because A7 stays word-aligned", () => {
    // move.b to -(sp) moves the stack pointer by 2, not 1.
    expect(
      flags(
        [
          "move.b d0,-(sp)",
          "move.w #9,-(sp)",
          "trap #1",
          "addq.l #4,sp",
          "rts",
        ].join("\n"),
      ),
    ).toBe(false);
    expect(
      flags(
        [
          "move.b d0,-(sp)",
          "move.w #9,-(sp)",
          "trap #1",
          "addq.l #3,sp",
          "rts",
        ].join("\n"),
      ),
    ).toBe(true);
  });

  test("stays quiet for GEMDOS calls that never return", () => {
    for (const opcode of ["#0", "#$4c", "#$31"]) {
      expect([
        opcode,
        flags([`move.w ${opcode},-(sp)`, "trap #1"].join("\n")),
      ]).toEqual([opcode, false]);
    }
  });

  test("covers BIOS and XBIOS but not GEM", () => {
    const pushes = ["move.w #2,-(sp)", "move.w #5,-(sp)"];
    expect(flags([...pushes, "trap #13", "rts"].join("\n"))).toBe(true);
    expect(flags([...pushes, "trap #14", "rts"].join("\n"))).toBe(true);
    // GEM passes a parameter block in registers, so there is nothing to clean up.
    expect(flags([...pushes, "trap #2", "rts"].join("\n"))).toBe(false);
  });

  test("accepts cleanup deferred and batched across calls", () => {
    // A documented idiom: make several calls, then remove all their parameters
    // with one adjustment. Checking each call against the next instruction
    // would report every call but the last.
    const two = ["move.w #1,-(sp)", "trap #1", "move.w #2,-(sp)", "trap #1"];
    expect(flags([...two, "addq.l #4,sp", "rts"].join("\n"))).toBe(false);
    // The total still has to be right.
    expect(flags([...two, "addq.l #2,sp", "rts"].join("\n"))).toBe(true);
  });

  test("does not run on other platforms", () => {
    expect(
      ids(call(), {
        processors: ["mc68000"],
        platform: "amiga",
        measureImpact: false,
      }),
    ).not.toContain(ID);
    expect(
      ids(call(), { processors: ["mc68000"], measureImpact: false }),
    ).not.toContain(ID);
  });
});

describe("Atari absolute-address footguns", () => {
  const st = {
    processors: ["mc68000"],
    platform: "atari",
    goal: "balanced",
    measureImpact: false,
  } as LintConfig;
  const ID = "suspicious/unexpected-absolute-address";

  test("accepts every spelling of the same hardware register", () => {
    // The 68000 address bus is 24 bits, so $FFFF8240 and $FF8240 decode
    // identically, and source may hold the negative word the encoding uses.
    for (const source of [
      "move.w $ff8240,d0",
      "move.w $ffff8240,d0",
      "move.w $ffff8240.w,d0",
      "move.w -32192,d0",
    ]) {
      expect(ids(source, st)).not.toContain(ID);
    }
  });

  test("accepts system variables and exception vectors", () => {
    // `move.l $44e,a0` for the screen base is idiomatic ST code.
    expect(ids("move.l $44e,a0", st)).not.toContain(ID);
    expect(ids("move.l $70,a0", st)).not.toContain(ID);
  });

  test("accepts the whole hardware map, not just the palette block", () => {
    const registers: [string, string][] = [
      ["MMU memory configuration", "move.b $ff8001,d0"],
      ["video palette", "move.w $ff8240,d0"],
      ["DMA / FDC", "move.w $ff8604,d0"],
      ["PSG", "move.b $ff8800,d0"],
      ["STE DMA sound", "move.b $ff8900,d0"],
      ["blitter", "move.w $ff8a00,d0"],
      ["Mega STE SCC", "move.b $ff8c80,d0"],
      ["STE joystick", "move.w $ff9200,d0"],
      ["MFP GPIP", "move.b $fffa01,d0"],
      // TDDR drives the 200Hz system timer and sits past the palette block.
      ["MFP TDDR", "move.b $fffa25,d0"],
      ["MFP UDR", "move.b $fffa2f,d0"],
      ["second MFP", "move.b $fffa81,d0"],
      ["keyboard ACIA", "move.b $fffc02,d0"],
      ["MIDI ACIA", "move.b $fffc06,d0"],
    ];
    for (const [label, source] of registers) {
      expect([label, ids(source, st).includes(ID)]).toEqual([label, false]);
    }
  });

  test("still flags values that could plausibly be an intended immediate", () => {
    expect(ids("move.w $1234,d0", st)).toContain(ID);
    expect(ids("move.w $8000,d0", st)).toContain(ID);
  });

  test("still flags a plausible missing immediate prefix", () => {
    const diagnostic = lint("move.w $1234,d0", st).find((d) => d.ruleId === ID);
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain("Atari");
    expect(diagnostic?.message).toContain("#$1234");
  });

  test("covers STE and Mega STE hardware under the one Atari platform", () => {
    // The models are not separate platforms: their extra hardware sits inside
    // the same blocks, and splitting would only narrow the map.
    expect(ids("move.b $ff8900,d0", st)).not.toContain(ID); // STE DMA sound
    expect(ids("move.w $ff8a00,d0", st)).not.toContain(ID); // blitter
    expect(ids("move.b $fffa81,d0", st)).not.toContain(ID); // Mega STE second MFP
  });

  test("does not run in generic platform mode", () => {
    expect(
      ids("move.w $ff8240,d0", {
        processors: ["mc68000"],
        measureImpact: false,
      }),
    ).not.toContain(ID);
  });

  test("Amiga ranges are unaffected by the Atari aliasing", () => {
    const amiga = { ...st, platform: "amiga" } as LintConfig;
    expect(ids("move.w $dff002,d0", amiga)).not.toContain(ID);
    expect(ids("move.w $ff8240,d0", amiga)).toContain(ID);
    expect(ids("move.w $1234,d0", amiga)).toContain(ID);
  });
});

describe("Amiga suspicious absolute-address footguns", () => {
  const amiga = {
    processors: ["mc68000"],
    platform: "amiga",
    goal: "balanced",
    measureImpact: false,
  } as LintConfig;

  test("flags an unusual numeric absolute source that may be a missing immediate prefix", () => {
    const result = lint("move.w $1234,d0\n", amiga);
    const d = result.find(
      (x) => x.ruleId === "suspicious/unexpected-absolute-address",
    );
    expect(d).toBeDefined();
    expect(d?.message).toContain("#$1234");
  });

  test("allows the configured zero-page vector range", () => {
    expect(
      lint("move.l $bc,d0\n", amiga).some(
        (x) => x.ruleId === "suspicious/unexpected-absolute-address",
      ),
    ).toBe(false);
  });

  test("allows the configured custom-register range", () => {
    expect(
      lint("move.w $dff002,d0\n", amiga).some(
        (x) => x.ruleId === "suspicious/unexpected-absolute-address",
      ),
    ).toBe(false);
  });

  test("allows the configured CIA register range", () => {
    expect(
      lint("move.b $bfe001,d0\n", amiga).some(
        (x) => x.ruleId === "suspicious/unexpected-absolute-address",
      ),
    ).toBe(false);
  });

  test("suppresses the heuristic for files containing ORG", () => {
    expect(
      lint("    org $1000\n    move.w $1234,d0\n", amiga).some(
        (x) => x.ruleId === "suspicious/unexpected-absolute-address",
      ),
    ).toBe(false);
  });

  test("does not guess about ordinary symbolic addresses", () => {
    expect(
      lint("move.w foo,d0\nfoo: dc.w 1\n", amiga).some(
        (x) => x.ruleId === "suspicious/unexpected-absolute-address",
      ),
    ).toBe(false);
  });

  test("does not flag absolute destinations because they cannot be a missing immediate", () => {
    expect(
      lint("move.w d0,$1234\n", amiga).some(
        (x) => x.ruleId === "suspicious/unexpected-absolute-address",
      ),
    ).toBe(false);
  });

  test("does not run in generic platform mode", () => {
    expect(
      lint("move.w $1234,d0\n", {
        processors: ["mc68000"],
        platform: "generic",
        goal: "balanced",
        measureImpact: false,
      }).some((x) => x.ruleId === "suspicious/unexpected-absolute-address"),
    ).toBe(false);
  });
});

describe("previously untested rules (coverage audit)", () => {
  test("compares a small long immediate through a dead scratch register", () => {
    const source = ["cmp.l #42,d1", "moveq #0,d0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/compare-long-immediate-via-moveq",
    );
    expect(diagnostic).toBeDefined();
    // The scratch register is loaded with the compared value (42), not the
    // value used in the fixture to prove d0 dead.
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmoveq #42,d0\n\tcmp.l d0,d1",
    );
  });

  test("does not offer the scratch-register compare when the constant is out of MOVEQ range", () => {
    const source = ["cmp.l #200,d1", "moveq #0,d0", "rts"].join("\n");
    expect(ids(source)).not.toContain(
      "optimization/compare-long-immediate-via-moveq",
    );
  });

  test("collapses a small compare-and-branch into a destructive SUBQ when the register is dead", () => {
    // Both paths converge immediately at `target`, so the overwrite there
    // proves d0 and X dead on every path out of the branch. Merely reaching
    // RTS unmodified leaves flags "unknown" rather than "dead" (see CCR
    // analysis above), which is not enough for this rule.
    const source = [
      "cmp.w #4,d0",
      "beq target",
      "target:",
      "moveq #0,d0",
      "add.l d1,d2",
      "rts",
    ].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/destructive-small-compare-branch",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tsubq.w #4,d0\n\tbeq target",
    );
  });

  test("does not use destructive SUBQ when the compared register is read afterwards", () => {
    const source = [
      "cmp.w #4,d0",
      "beq target",
      "target:",
      "move.w d0,d1",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain(
      "optimization/destructive-small-compare-branch",
    );
  });

  test("turns JSR followed by JMP into a pre-pushed continuation", () => {
    const source = ["jsr Sub", "jmp Cont", "Sub:", "rts", "Cont:", "rts"].join(
      "\n",
    );
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/jsr-jmp-tail-dispatch",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\tpea Cont\n\tjmp Sub");
  });

  test("does not combine JSR/JMP across an intervening label", () => {
    const source = [
      "jsr Sub",
      "mid:",
      "jmp Cont",
      "Sub:",
      "rts",
      "Cont:",
      "rts",
    ].join("\n");
    expect(ids(source)).not.toContain("optimization/jsr-jmp-tail-dispatch");
  });

  test("narrows a signed-16-bit MOVEA.L immediate to MOVEA.W on 68000", () => {
    const diagnostic = lint("movea.l #1234,a0").find(
      (d) => d.ruleId === "optimization/narrow-movea-immediate-word",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\tmovea.w #1234,a0");
  });

  test("narrows MOVEA.L immediates on every target checked", () => {
    // Verified with 68kcounter: a clean win on every target it models
    // (68000/68020/68030/68040/68060); 68010 follows 68000.
    for (const cpu of [
      "mc68000",
      "mc68010",
      "mc68020",
      "mc68030",
      "mc68040",
      "mc68060",
    ] as const) {
      expect(ids("movea.l #1234,a0", { processors: [cpu] })).toContain(
        "optimization/narrow-movea-immediate-word",
      );
    }
  });

  test("narrows a signed-16-bit ADDA.L immediate to ADDA.W on 68000", () => {
    const diagnostic = lint("adda.l #1234,a0").find(
      (d) => d.ruleId === "optimization/narrow-address-immediate-word",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\tadda.w #1234,a0");
  });

  test("narrows a signed-16-bit SUBA.L immediate to SUBA.W on 68000", () => {
    const diagnostic = lint("suba.l #1234,a0").find(
      (d) => d.ruleId === "optimization/narrow-address-immediate-word",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tsuba.w #1234,a0");
  });

  test("does not narrow an ADDA.L immediate that does not fit a signed word", () => {
    expect(ids("adda.l #32768,a0")).not.toContain(
      "optimization/narrow-address-immediate-word",
    );
  });

  test("simplifies AND.L #$FFFF,Dn to a word clear without a long immediate", () => {
    // Reaching RTS unmodified leaves NZVC merely "unknown"; an explicit
    // overwrite on another register is what proves them dead (see CCR
    // analysis above).
    const source = ["and.l #$ffff,d0", "move.l d1,d2", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/simplify-long-word-mask",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tswap d0\n\tclr.w d0\n\tswap d0",
    );
    expect(diagnostic?.suggestion?.applicability).toBe("safe");
  });

  test("simplifies AND.L #$FFFF0000,Dn to a plain word clear", () => {
    const source = ["and.l #$ffff0000,d0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/simplify-long-word-mask",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tclr.w d0");
  });

  test("does not simplify an AND.L mask that is not one of the two known word masks", () => {
    expect(ids("and.l #$00ff00ff,d0")).not.toContain(
      "optimization/simplify-long-word-mask",
    );
  });

  test("normalizes a long-direction byte rotate to the shorter opposite direction", () => {
    const diagnostic = lint("rol.b #5,d0").find(
      (d) => d.ruleId === "optimization/normalize-byte-rotate-direction",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\tror.b #3,d0");
  });

  test("does not normalize a byte rotate count that is already the shorter direction", () => {
    expect(ids("rol.b #3,d0")).not.toContain(
      "optimization/normalize-byte-rotate-direction",
    );
  });

  test("replaces DIVU.L by a power of two with an immediate LSR on 68020+", () => {
    const diagnostic = lint("divu.l #4,d0", { processors: ["mc68020"] }).find(
      (d) => d.ruleId === "optimization/divu-long-power-of-two",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\tlsr.l #2,d0");
  });

  test("uses a dead scratch register for a large DIVU.L shift count", () => {
    const source = ["divu.l #512,d0", "moveq #0,d1", "rts"].join("\n");
    const diagnostic = lint(source, { processors: ["mc68020"] }).find(
      (d) => d.ruleId === "optimization/divu-long-power-of-two",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmoveq #9,d1\n\tlsr.l d1,d0",
    );
  });

  test("does not offer DIVU.L shift replacement on 68000/68010, which lack DIVU.L", () => {
    expect(ids("divu.l #4,d0", { processors: ["mc68000"] })).not.toContain(
      "optimization/divu-long-power-of-two",
    );
  });

  test("uses TST.L An in place of CMPA.L #0,An on 68030", () => {
    const diagnostic = lint("cmpa.l #0,a0", { processors: ["mc68030"] }).find(
      (d) => d.ruleId === "optimization/cmpa-zero-to-tst-030",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\ttst.l a0");
  });

  test("does not offer the CMPA-to-TST substitution off 68030", () => {
    expect(ids("cmpa.l #0,a0", { processors: ["mc68000"] })).not.toContain(
      "optimization/cmpa-zero-to-tst-030",
    );
  });

  test("uses MOVEQ #0 for MULS.L by zero on 68060", () => {
    const diagnostic = lint("muls.l #0,d0", { processors: ["mc68060"] }).find(
      (d) => d.ruleId === "optimization/muls-long-060-simple",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\tmoveq #0,d0");
  });

  test("uses an immediate ASL for a power-of-two MULS.L on 68060", () => {
    const diagnostic = lint("muls.l #8,d0", { processors: ["mc68060"] }).find(
      (d) => d.ruleId === "optimization/muls-long-060-simple",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\tasl.l #3,d0");
  });

  test("does not offer the MULS.L 68060 simplification off 68060", () => {
    expect(ids("muls.l #8,d0", { processors: ["mc68000"] })).not.toContain(
      "optimization/muls-long-060-simple",
    );
  });

  test("uses a register-count ASL for a large power-of-two long multiply", () => {
    const source = ["muls.l #1024,d0", "moveq #0,d1", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/multiply-long-large-power-of-two",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmoveq #10,d1\n\tasl.l d1,d0",
    );
  });

  test("does not use the large-power-of-two recipe for a shift the rule does not cover", () => {
    // 2^9 = 512 is at the boundary (shift must be strictly greater than 9).
    const source = ["muls.l #512,d0", "moveq #0,d1", "rts"].join("\n");
    expect(ids(source)).not.toContain(
      "optimization/multiply-long-large-power-of-two",
    );
  });

  test("replaces a small-constant long multiply with a shift/add recipe", () => {
    const source = ["muls.l #3,d0", "moveq #0,d1", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/multiply-long-small-constant",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmove.l d0,d1\n\tadd.l d0,d0\n\tadd.l d1,d0",
    );
  });

  test("does not offer a shift/add recipe for a constant with none defined", () => {
    const source = ["muls.l #11,d0", "moveq #0,d1", "rts"].join("\n");
    expect(ids(source)).not.toContain(
      "optimization/multiply-long-small-constant",
    );
  });

  test("combines EXT.W plus EXT.L on the same register into EXTB.L from the 68020 on", () => {
    const source = ["ext.w d0", "ext.l d0"].join("\n");
    for (const cpu of ["mc68020", "mc68030", "mc68040", "mc68060"] as const) {
      const diagnostic = lint(source, { processors: [cpu] }).find(
        (d) => d.ruleId === "optimization/combine-ext-byte",
      );
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.suggestion?.replacement).toBe("\textb.l d0");
    }
  });

  test("does not combine EXT.W/EXT.L across different registers", () => {
    const source = ["ext.w d0", "ext.l d1"].join("\n");
    expect(ids(source, { processors: ["mc68040"] })).not.toContain(
      "optimization/combine-ext-byte",
    );
  });

  test("does not combine EXT.W/EXT.L outside the 68020+ scope", () => {
    // EXTB.L doesn't exist before the 68020, and CPU32 is left out deliberately
    // (see negative-signed-multiply.ts for the same "68020-and-up, not CPU32" list).
    const source = ["ext.w d0", "ext.l d0"].join("\n");
    expect(ids(source, { processors: ["mc68010"] })).not.toContain(
      "optimization/combine-ext-byte",
    );
    expect(ids(source, { processors: ["cpu32"] })).not.toContain(
      "optimization/combine-ext-byte",
    );
  });

  test("uses TST in place of adding zero", () => {
    const source = ["add.w #0,d0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/zero-arithmetic-to-tst",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe("\ttst.w d0");
  });

  test("uses TST in place of subtracting zero", () => {
    const source = ["sub.l #0,d0", "rts"].join("\n");
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/zero-arithmetic-to-tst",
    );
    expect(diagnostic?.suggestion?.replacement).toBe("\ttst.l d0");
  });

  test("does not replace adding a non-zero immediate with TST", () => {
    expect(ids("add.w #1,d0")).not.toContain(
      "optimization/zero-arithmetic-to-tst",
    );
  });

  test("replaces ADD #0 with TST on every target checked, including 68040/68060", () => {
    // Verified with 68kcounter: 68040/68060 tie on cycles but TST still
    // drops the immediate word, so it stays a clean win there too.
    for (const cpu of [
      "mc68000",
      "mc68010",
      "mc68020",
      "mc68030",
      "mc68040",
      "mc68060",
    ] as const) {
      expect(ids("add.w #0,d0", { processors: [cpu] })).toContain(
        "optimization/zero-arithmetic-to-tst",
      );
    }
  });

  test("synthesizes an immediate just below the MOVEQ range with MOVEQ plus SUBQ", () => {
    const diagnostic = lint("move.l #-130,d0").find(
      (d) => d.ruleId === "optimization/move-immediate-below-moveq",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmoveq #-128,d0\n\tsubq.l #2,d0",
    );
  });

  test("does not use the below-MOVEQ synthesis for a value already in MOVEQ range", () => {
    expect(ids("move.l #-128,d0")).not.toContain(
      "optimization/move-immediate-below-moveq",
    );
  });

  test("synthesizes a value in 128..255 with MOVEQ plus NOT.B", () => {
    const diagnostic = lint("move.l #200,d0").find(
      (d) => d.ruleId === "optimization/move-immediate-byte-complement",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\tmoveq #55,d0\n\tnot.b d0",
    );
  });

  test("does not use the byte-complement synthesis outside 128..255", () => {
    expect(ids("move.l #100,d0")).not.toContain(
      "optimization/move-immediate-byte-complement",
    );
  });
});
