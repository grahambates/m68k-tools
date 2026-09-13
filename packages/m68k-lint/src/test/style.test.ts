import { lintSource } from "../core/lint.js";

const base = { processors: ["mc68000" as const], measureImpact: false };

describe("style size qualifier rules", () => {
  test("style rules are disabled by default", () => {
    const diagnostics = lintSource("    move d0,d1\n    lea.l foo,a0\n", base);
    expect(diagnostics.some((d) => d.category === "style")).toBe(false);
  });

  test("style preset requires size on variable-size instructions", () => {
    const diagnostics = lintSource("    move d0,d1\n", {
      ...base,
      presets: ["style"],
    });
    expect(
      diagnostics.some((d) => d.ruleId === "style/require-instruction-size"),
    ).toBe(true);
  });

  test("explicit size satisfies variable-size rule", () => {
    const diagnostics = lintSource("    move.l d0,d1\n", {
      ...base,
      presets: ["style"],
    });
    expect(
      diagnostics.some((d) => d.ruleId === "style/require-instruction-size"),
    ).toBe(false);
  });

  test("style preset rejects redundant LEA size", () => {
    const diagnostics = lintSource("    lea.l foo,a0\n", {
      ...base,
      presets: ["style"],
    });
    const diagnostic = diagnostics.find(
      (d) => d.ruleId === "style/omit-redundant-instruction-size",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion?.replacement).toContain("lea foo,a0");
  });

  test("branch size omission is not treated as a style violation", () => {
    const diagnostics = lintSource("    bra target\ntarget:\n    nop\n", {
      ...base,
      presets: ["style"],
    });
    expect(
      diagnostics.some((d) => d.ruleId === "style/require-instruction-size"),
    ).toBe(false);
  });
});

describe("semantic mnemonic style rules", () => {
  test("style preset prefers explicit address-register mnemonics", () => {
    const diagnostics = lintSource("    move.w d0,a0\n    add.l #4,a1\n", {
      ...base,
      presets: ["style"],
    });
    const hits = diagnostics.filter(
      (d) => d.ruleId === "style/prefer-address-register-mnemonics",
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]?.suggestion?.replacement).toContain("movea.w d0,a0");
    expect(hits[1]?.suggestion?.replacement).toContain("adda.l #4,a1");
  });

  test("explicit address-register mnemonic satisfies the style rule", () => {
    const diagnostics = lintSource("    movea.w d0,a0\n", {
      ...base,
      presets: ["style"],
    });
    expect(
      diagnostics.some(
        (d) => d.ruleId === "style/prefer-address-register-mnemonics",
      ),
    ).toBe(false);
  });

  test("DBRA/DBF preference is individually opt-in", () => {
    const defaultDiagnostics = lintSource("    dbf d0,loop\nloop:\n    nop\n", {
      ...base,
      presets: ["style"],
    });
    expect(
      defaultDiagnostics.some((d) => d.ruleId === "style/prefer-dbra"),
    ).toBe(false);
    const diagnostics = lintSource("    dbf d0,loop\nloop:\n    nop\n", {
      ...base,
      rules: { "style/prefer-dbra": "info" },
    });
    expect(
      diagnostics.find((d) => d.ruleId === "style/prefer-dbra")?.suggestion
        ?.replacement,
    ).toContain("dbra d0,loop");
  });

  test("unsigned condition alias preference is individually opt-in", () => {
    const diagnostics = lintSource("    bcc target\ntarget:\n    nop\n", {
      ...base,
      rules: { "style/prefer-unsigned-condition-aliases": "info" },
    });
    expect(
      diagnostics.find(
        (d) => d.ruleId === "style/prefer-unsigned-condition-aliases",
      )?.suggestion?.replacement,
    ).toContain("bhs target");
  });

  test("DBF preference is the opposite direction from DBRA and is also opt-in", () => {
    const defaultDiagnostics = lintSource(
      "    dbra d0,loop\nloop:\n    nop\n",
      { ...base, presets: ["style"] },
    );
    expect(
      defaultDiagnostics.some((d) => d.ruleId === "style/prefer-dbf"),
    ).toBe(false);
    const diagnostics = lintSource("    dbra d0,loop\nloop:\n    nop\n", {
      ...base,
      rules: { "style/prefer-dbf": "info" },
    });
    expect(
      diagnostics.find((d) => d.ruleId === "style/prefer-dbf")?.suggestion
        ?.replacement,
    ).toContain("dbf d0,loop");
  });

  test("carry condition alias preference is the opposite direction from HS/LO and is also opt-in", () => {
    const diagnostics = lintSource("    bhs target\ntarget:\n    nop\n", {
      ...base,
      rules: { "style/prefer-carry-condition-aliases": "info" },
    });
    expect(
      diagnostics.find(
        (d) => d.ruleId === "style/prefer-carry-condition-aliases",
      )?.suggestion?.replacement,
    ).toContain("bcc target");
  });
});
