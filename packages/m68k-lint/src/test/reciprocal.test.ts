import parse from "68kcounter";
import { lint } from "./helpers.js";
import {
  shiftInstructions,
  signedCycles,
  signedReciprocals,
  undominated,
  unsignedCycles,
  unsignedReciprocals,
  widest,
} from "../rules/optimization/reciprocal.js";

/** 68000 cycles for some lines, from 68kcounter. */
const cycles = (lines: string[]) =>
  parse(lines.map((l) => `\t${l}\n`).join(""), { cpu: "68000" }).reduce(
    (total, l) =>
      l.statement?.opcode ? total + (l.timing?.values?.[0]?.[0] ?? 0) : total,
    0,
  );

const DIVISORS = [
  3, 5, 6, 7, 9, 10, 11, 12, 13, 15, 17, 24, 60, 100, 255, 1000,
];

describe("the reciprocal for an unsigned divide", () => {
  test("is exact for every dividend it says it is, and wrong just beyond", () => {
    for (const d of DIVISORS) {
      for (const r of unsignedReciprocals(d)) {
        const scale = 2 ** (16 + r.shift);
        const divide = (x: number) => Math.floor((x * r.multiplier) / scale);
        for (let x = 0; x <= r.max; x++)
          if (divide(x) !== Math.floor(x / d))
            throw new Error(
              `${d} at scale ${scale}: wrong at ${x}, below ${r.max}`,
            );
        // The bound is the last one that works, not just a safe one.
        if (r.max < 0xffff)
          expect(divide(r.max + 1), `${d} at scale ${scale}`).not.toBe(
            Math.floor((r.max + 1) / d),
          );
      }
    }
  });

  test("is the multiplier rounded up from the scale over the divisor", () => {
    for (const d of DIVISORS)
      for (const r of unsignedReciprocals(d))
        expect(r.multiplier).toBe(Math.ceil(2 ** (16 + r.shift) / d));
  });

  test("has to round up: nearest or down is wrong almost at once", () => {
    // 65536/3 is 21845.33: nearest and down both give 21845, which divides 3 by 3 as 0.
    expect(Math.floor((3 * 21845) / 65536)).toBe(0);
    expect(unsignedReciprocals(3)[0].multiplier).toBe(21846);
    expect(Math.floor((3 * 21846) / 65536)).toBe(1);
  });

  test("fits a 16-bit immediate", () => {
    for (const d of DIVISORS)
      for (const r of unsignedReciprocals(d))
        expect(r.multiplier).toBeLessThanOrEqual(0xffff);
  });

  test("reaches the full 16 bits for a divisor that has the precision for it", () => {
    expect(widest(unsignedReciprocals(3))?.max).toBe(0xffff);
    expect(widest(unsignedReciprocals(10))?.max).toBe(0xffff);
    // A scale of $10000 alone stops short: ÷10 at $10000 is 6554, exact to 16388.
    expect(unsignedReciprocals(10)[0]).toMatchObject({
      multiplier: 6554,
      shift: 0,
      max: 16388,
    });
  });

  test("shrinks as the divisor grows, which is the range against accuracy trade", () => {
    const at = (d: number) => unsignedReciprocals(d)[0]?.max ?? 0;
    expect(at(1000)).toBeLessThan(at(100));
    expect(at(100)).toBeLessThan(at(10));
  });

  test("drops a scale that a smaller shift already covers", () => {
    // ÷10 at $20000 is exact to the same 16388 as at $10000, and costs a shift more.
    const all = unsignedReciprocals(10);
    expect(all.map((r) => r.shift)).toContain(1);
    expect(undominated(all).map((r) => r.shift)).not.toContain(1);
  });

  test("its cycles agree with 68kcounter", () => {
    for (const d of DIVISORS)
      for (const r of unsignedReciprocals(d))
        expect(
          unsignedCycles(r),
          `${d} at shift ${r.shift}, multiplier ${r.multiplier}`,
        ).toBe(
          cycles([
            `mulu.w #${r.multiplier},d0`,
            "swap d0",
            ...shiftInstructions("lsr", "d0", r.shift),
          ]),
        );
  });
});

describe("the reciprocal for a signed divide", () => {
  test("rounds toward zero over every dividend it says it is exact for", () => {
    for (const d of DIVISORS.filter((x) => x < 0x8000)) {
      for (const r of signedReciprocals(d)) {
        const scale = 2 ** (16 + r.shift);
        const divide = (x: number) =>
          Math.floor((x * r.multiplier) / scale) + (x < 0 ? 1 : 0);
        for (let x = r.min; x <= r.max; x++)
          if (divide(x) !== Math.trunc(x / d))
            throw new Error(`${d} at scale ${scale}: wrong at ${x}`);
      }
    }
  });

  test("fits MULS.W's signed word", () => {
    for (const d of DIVISORS)
      for (const r of signedReciprocals(d))
        expect(r.multiplier).toBeLessThanOrEqual(0x7fff);
  });

  test("covers the whole signed word for a divisor with the precision for it", () => {
    const w = widest(signedReciprocals(10));
    expect([w?.min, w?.max]).toEqual([-32768, 32767]);
  });

  test("its cycles agree with 68kcounter, negated or not", () => {
    for (const d of DIVISORS)
      for (const r of signedReciprocals(d))
        for (const negated of [false, true])
          expect(
            signedCycles(r, negated),
            `${d} at shift ${r.shift}, multiplier ${r.multiplier}`,
          ).toBe(
            cycles([
              "move.w d0,d2",
              `muls.w #${r.multiplier},d0`,
              "swap d0",
              ...shiftInstructions("asr", "d0", r.shift),
              "add.w d2,d2",
              "clr.w d2",
              "addx.w d2,d0",
              ...(negated ? ["neg.w d0"] : []),
            ]),
          );
  });
});

const ID_U = "optimization/divu-word-by-constant";
const ID_S = "optimization/divs-word-by-constant";
const ID_P = "optimization/divs-word-power-of-two";
const find = (source: string, id: string) =>
  lint(source, { processors: ["mc68000"] }).find((d) => d.ruleId === id);
/** The quotient goes to d2, d0 is then overwritten, and d7 is free. */
const after = "\n\tmove.w d0,d2\n\tmoveq #0,d0\n\tmoveq #0,d7\n\trts";

describe("a divisor that is written as an expression", () => {
  test("gets a multiplier written from it, so that it follows the constant", () => {
    const d = find(`MY_DIV equ 10\n\tdivu #MY_DIV,d0${after}`, ID_U);
    expect(d?.suggestion?.replacement).toBe(
      "\tmulu.w #$80000/MY_DIV+1,d0\n\tswap d0\n\tlsr.w #3,d0",
    );
    expect(d?.message).toContain("by MY_DIV");
  });

  test("brackets anything that is not a single name or number", () => {
    const d = find(
      `MY_DIV equ 5\nSCALE equ 2\n\tdivu #MY_DIV*SCALE,d0${after}`,
      ID_U,
    );
    expect(d?.suggestion?.replacement).toContain("#$80000/(MY_DIV*SCALE)+1,d0");
  });

  test("brackets a signed one, whose sign is a NEG after the multiply", () => {
    const d = find(`A_B equ 5\n\tdivs #-(A_B*2),d0${after}`, ID_S);
    // Not `$40000/A_B*2+1`, which divides by A_B and doubles the result.
    expect(d?.suggestion?.replacement).toContain("#$40000/(A_B*2)+1,d0");
    expect(d?.suggestion?.replacement?.endsWith("neg.w d0")).toBe(true);
  });

  test("uses the name of a negative constant with its sign taken off", () => {
    const d = find(`NEG_DIV equ -10\n\tdivs #NEG_DIV,d0${after}`, ID_S);
    expect(d?.suggestion?.replacement).toContain("#$40000/(-NEG_DIV)+1,d0");
  });

  test("keeps the scale in the expression for each alternative it lists", () => {
    const d = find(`MY_DIV equ 10\n\tdivu #MY_DIV,d0${after}`, ID_U);
    const smaller = (d?.alternatives ?? []).map(
      (alt) => alt.suggestion?.replacement,
    );
    expect(smaller.some((m) => m?.includes("#$40000/MY_DIV+1"))).toBe(true);
    expect(smaller.some((m) => m?.includes("#$10000/MY_DIV+1"))).toBe(true);
  });

  test("an alternative is obfuscated too, since it is the same rule's finding", () => {
    const d = find(`\tdivu #7,d0${after}`, ID_U);
    expect(d?.suggestion?.obfuscated).toBe(true);
    expect(d?.alternatives?.length).toBeGreaterThan(0);
    for (const alt of d?.alternatives ?? [])
      expect(alt.suggestion?.obfuscated).toBe(true);
  });

  test("an alternative carries the same configured severity as the primary", () => {
    const d = lint(`\tdivu #7,d0${after}`, {
      processors: ["mc68000"],
      rules: { [ID_U]: "warning" },
    }).find((x) => x.ruleId === ID_U);
    expect(d?.severity).toBe("warning");
    for (const alt of d?.alternatives ?? [])
      expect(alt.severity).toBe("warning");
  });

  test("says what was checked, and that it was for the current value only", () => {
    const d = find(`MY_DIV equ 10\n\tdivu #MY_DIV,d0${after}`, ID_U);
    expect(
      d?.notes?.some((n) => /checked for MY_DIV = 10 only/.test(n.message)),
    ).toBe(true);
  });

  test("is not offered the recipes made for one value, which would go stale", () => {
    const named = find(`MY_DIV equ 10\n\tdivu #MY_DIV,d0${after}`, ID_U);
    expect(named?.notes?.some((n) => /Made for/.test(n.message))).toBe(false);
    // The same divisor as a number is.
    const literal = find(`\tdivu #10,d0${after}`, ID_U);
    expect(literal?.notes?.some((n) => /Made for 10/.test(n.message))).toBe(
      true,
    );
  });

  test("a power of two still gets a shift, and the name it loses is said out loud", () => {
    // There is no log2 in an assembler, so the shift count cannot be written from
    // the constant. The rule fires anyway, and the loss is reported for the
    // reader, as it is for the other rules that derive a value.
    const d = find(`SHIFTED equ 8\n\tdivs #SHIFTED,d0${after}`, ID_P);
    expect(d?.suggestion?.replacement).toContain("asr.l #3,d0");
    expect(
      d?.notes?.some((n) =>
        /SHIFTED does not appear in the replacement/.test(n.message),
      ),
    ).toBe(true);
    expect(d?.data?.symbolsLost).toEqual(["SHIFTED"]);
  });

  test("a reciprocal that keeps the name has nothing to report", () => {
    for (const [source, id] of [
      [`MY_DIV equ 10\n\tdivu #MY_DIV,d0${after}`, ID_U],
      [`MY_DIV equ 10\n\tdivs #MY_DIV,d0${after}`, ID_S],
    ] as const) {
      const d = find(source, id);
      expect(d?.data?.symbolsLost).toBeUndefined();
      expect(d?.notes?.some((n) => /does not appear/.test(n.message))).toBe(
        false,
      );
    }
  });

  test("still gets a shift for a divisor written as a number", () => {
    expect(find(`\tdivs #8,d0${after}`, ID_P)).toBeDefined();
  });

  test("is left alone when it is not a known value", () => {
    expect(find(`\tdivu #UNKNOWN,d0${after}`, ID_U)).toBeUndefined();
  });
});

describe("a divisor that is a number or a numeric expression", () => {
  test("is written as the scale over the divisor, which says how the multiplier was made", () => {
    // `#52429` is a magic number; this shows where it came from.
    expect(find(`\tdivu #10,d0${after}`, ID_U)?.suggestion?.replacement).toBe(
      "\tmulu.w #$80000/10+1,d0\n\tswap d0\n\tlsr.w #3,d0",
    );
    expect(
      find(`\tdivs #10,d0${after}`, ID_S)?.suggestion?.replacement,
    ).toContain("muls.w #$40000/10+1,d0");
  });

  test("keeps a numeric expression as it was written, bracketed", () => {
    expect(
      find(`\tdivu #5*2,d0${after}`, ID_U)?.suggestion?.replacement,
    ).toContain("#$80000/(5*2)+1,d0");
    expect(
      find(`\tdivs #(5*2),d0${after}`, ID_S)?.suggestion?.replacement,
    ).toContain("#$40000/(5*2)+1,d0");
  });

  test("uses the size of a negative number, with the sign as a NEG after", () => {
    const d = find(`\tdivs #-10,d0${after}`, ID_S);
    expect(d?.suggestion?.replacement).toContain("#$40000/10+1,d0");
    expect(d?.suggestion?.replacement?.endsWith("neg.w d0")).toBe(true);
  });

  test("takes the sign off a negated numeric expression, and keeps what is inside", () => {
    expect(
      find(`\tdivs #-(5*2),d0${after}`, ID_S)?.suggestion?.replacement,
    ).toContain("#$40000/(5*2)+1,d0");
  });

  test("still shows the number the expression works out to", () => {
    const d = find(`\tdivu #10,d0${after}`, ID_U);
    expect(d?.notes?.[0]?.message).toMatch(/ceil\(\$80000\/10\) = 52429/);
  });

  test("has no name to lose, so nothing to report", () => {
    for (const [source, id] of [
      [`\tdivu #5*2,d0${after}`, ID_U],
      [`\tdivs #-(5*2),d0${after}`, ID_S],
    ] as const) {
      const d = find(source, id);
      expect(d?.data?.symbolsLost).toBeUndefined();
    }
  });

  test("still lists the recipes made for one value, since there is no constant to follow", () => {
    const d = find(`\tdivu #10,d0${after}`, ID_U);
    expect(d?.notes?.some((n) => /Made for 10/.test(n.message))).toBe(true);
  });
});

describe("a divisor written as a number", () => {
  test("gets the plain rounded-up multiplier, and its true bound", () => {
    const d = find(`\tdivu #7,d0${after}`, ID_U);
    expect(d?.suggestion?.replacement).toBe(
      "\tmulu.w #$20000/7+1,d0\n\tswap d0\n\tlsr.w #1,d0",
    );
    expect(d?.message).toContain("no more than 43692");
    expect(d?.notes?.[0]?.message).toMatch(/ceil\(\$20000\/7\) = 18725/);
  });

  test("lists a smaller scale only when it costs less", () => {
    const d = find(`\tdivu #7,d0${after}`, ID_U);
    // The primary is scale $20000; every listed alternative is cheaper, and
    // each is offered as a real, independently applicable choice.
    for (const alt of d?.alternatives ?? []) {
      expect(alt.suggestion?.applicability).toBe("conditional");
      expect(alt.suggestion?.replacement).toBeDefined();
      expect(alt.suggestion!.impact!.execution!.cpuCycles!.after!).toBeLessThan(
        unsignedCycles({ multiplier: 18725, shift: 1, min: 0, max: 0 }),
      );
    }
  });

  test("offers a divisor beyond the old table, with what range it has", () => {
    // The generated table stops at 300. The reciprocal does not.
    const d = find(`\tdivu #1000,d0${after}`, ID_U);
    expect(d).toBeDefined();
    expect(d?.message).toMatch(/no more than \d+/);
  });

  test("is not offered when even a byte is not covered", () => {
    // A divisor this large leaves a multiplier of a few bits, and no useful range.
    const wide = unsignedReciprocals(60000);
    expect(wide.every((r) => r.max >= 255)).toBe(true);
  });
});
