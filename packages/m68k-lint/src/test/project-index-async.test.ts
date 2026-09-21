import {
  buildProjectReferences,
  buildProjectReferencesAsync,
  buildProjectSymbols,
  buildProjectSymbolsAsync,
} from "../index.js";

/**
 * Building the index without blocking a server must give what building it in
 * one go does: only when the work is done differs.
 */
const files = Array.from({ length: 120 }, (_, i) => ({
  path: `f${i}.s`,
  source: [
    `CONST${i} equ ${i} * 2`,
    `\tXDEF label${i}`,
    `label${i}:`,
    `\tmove.w #CONST${(i + 1) % 120},d0`,
    `\tjsr label${(i + 7) % 120}`,
    i % 10 === 0 ? `\tmacro_${i % 3}` : "",
  ].join("\n"),
}));
files.push({
  path: "macros.i",
  source:
    "macro_0 macro\n\tmoveq #1,d0\n\tendm\nmacro_1 macro\n\tmoveq #2,d0\n\tendm\nmacro_2 macro\n\tmoveq #3,d0\n\tendm\n",
});

describe("building the project index without blocking", () => {
  test("gives the same symbols as building it in one go", async () => {
    const sync = buildProjectSymbols(files);
    const async_ = await buildProjectSymbolsAsync(files, {}, () =>
      Promise.resolve(),
    );
    expect(async_.size).toBe(sync.size);
    expect(async_.conflicts).toEqual(sync.conflicts);
    for (let i = 0; i < 120; i++)
      expect(async_.lookup(`CONST${i}`)).toEqual(sync.lookup(`CONST${i}`));
    for (const name of ["macro_0", "macro_1", "macro_2", "nothing"])
      expect(async_.macro?.(name)?.origin).toBe(sync.macro?.(name)?.origin);
  });

  test("gives the same references as building it in one go", async () => {
    const sync = buildProjectReferences(files);
    const async_ = await buildProjectReferencesAsync(files, {}, () =>
      Promise.resolve(),
    );
    for (let i = 0; i < 120; i++) {
      expect(async_.references(`label${i}`)).toBe(sync.references(`label${i}`));
      expect(async_.references(`CONST${i}`)).toBe(sync.references(`CONST${i}`));
    }
    for (const name of ["macro_0", "macro_1", "macro_2", "nothing"])
      expect(async_.invokes(name)).toBe(sync.invokes(name));
  });

  test("lets other work run as it goes, and not once per file", async () => {
    let yields = 0;
    const yieldNow = () => {
      yields++;
      return Promise.resolve();
    };
    await buildProjectSymbolsAsync(files, {}, yieldNow);
    const symbolYields = yields;
    await buildProjectReferencesAsync(files, {}, yieldNow);
    expect(symbolYields).toBeGreaterThan(2);
    expect(symbolYields).toBeLessThan(files.length / 2);
    expect(yields).toBeGreaterThan(symbolYields);
  });

  test("really returns to the event loop when it yields", async () => {
    let otherWorkRan = false;
    setImmediate(() => (otherWorkRan = true));
    await buildProjectSymbolsAsync(files);
    expect(otherWorkRan).toBe(true);
  });
});
