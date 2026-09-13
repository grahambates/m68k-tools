import { defaultRules } from "../rules/index.js";
import { lintSource } from "../core/lint.js";

/**
 * Diagnostics speak in the linter's own voice. Provenance belongs in rule
 * metadata (`docs.source`), which feeds the documentation, not in text a user
 * reads while fixing their code: they have no way to check what ASP68K said,
 * and a claim we repeat is a claim we own.
 */
const SOURCES =
  /\bASP68K\b|\bFlamewing\b|Tricks and Traps\b|\b68kcounter\b|\bEAB\b|Hardware Reference/i;

describe("diagnostic voice", () => {
  test("rule metadata records provenance", () => {
    // The guard below is only meaningful because sources are recorded elsewhere.
    const attributed = defaultRules.filter((rule) => rule.meta.docs?.source);
    expect(attributed.length).toBeGreaterThan(50);
  });

  test("no rule description names a source", () => {
    const named = defaultRules
      .filter((rule) => SOURCES.test(rule.meta.description))
      .map((rule) => rule.meta.id);
    expect(named).toEqual([]);
  });

  test("no emitted message, note or suggestion names a source", () => {
    // A broad sweep: enough shapes to reach the rules that carry notes.
    const sources = [
      "\tmove.l #42,d0\n\tmoveq #0,d7",
      "\tadd.l #1,d0\n\tclr.l d1\n\teor.l #-1,d2",
      "\tlea 0(a0),a0\n\tlea (a1),a1\n\tmovem.l d0,-(sp)",
      "\tandi.l #$ffff0000,d0\n\tmoveq #0,d7",
      "\tlsl.w #1,d0\n\tlsl.w #2,d1\n\tlsl.b #7,d2\n\tmoveq #0,d7",
      "\tmove.b #-1,(a0)\n\tmoveq #0,d7",
      "\tmuls.w #8,d0\n\tmulu.w #0,d1\n\tmoveq #0,d7",
      "\tmove.l a6,-(sp)\n\tmove.l sp,a6\n\tadd.w #-16,sp",
      "\tbra .x\n.x:\n\tmove.l #1234,a0\n\tmovea.l #100,a1",
      "\tbtst #7,d0\n\tbne .y\n.y:\n\tmoveq #0,d7",
      "\tcmp.l #0,d0\n\tadd.l #0,d1\n\tmove.l #0,a0",
      "\taddq.l #4,a0\n\tmove.l d0,-(a0)\n\tclr.b $1000\n\tclr.b $1001",
    ];
    const offenders: string[] = [];
    for (const source of sources) {
      for (const diagnostic of lintSource(source, {
        processors: ["mc68000"],
      })) {
        const texts = [
          diagnostic.message,
          diagnostic.suggestion?.description,
          ...(diagnostic.notes ?? []).map((note) => note.message),
        ].filter((text): text is string => text !== undefined);
        for (const text of texts) {
          if (SOURCES.test(text))
            offenders.push(`${diagnostic.ruleId}: ${text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
