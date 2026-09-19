import { lintSource } from "../core/lint.js";
import type { FileFacts } from "../core/facts.js";
import { applyFixes } from "../core/fix.js";
import { fixture } from "./helpers.js";

const RULE = "portability/include-case";
const facts = (entries: Record<string, string>): FileFacts => ({
  includeCase: new Map(Object.entries(entries)),
});
const lint = (source: string, given?: FileFacts) =>
  lintSource(
    fixture(source),
    { processors: ["mc68000"] },
    undefined,
    undefined,
    undefined,
    given,
  ).filter((d) => d.ruleId === RULE);

describe("portability/include-case", () => {
  test("flags an include spelled differently from the file on disk", () => {
    const found = lint(
      '\tinclude "hardware.i"',
      facts({ "hardware.i": "Hardware.i" }),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("'hardware.i' is 'Hardware.i' on disk");
    expect(found[0].severity).toBe("warning");
  });

  test("puts the finding on the path", () => {
    const [found] = lint(
      '\tinclude "hardware.i"',
      facts({ "hardware.i": "Hardware.i" }),
    );
    expect(found.loc.line).toBe(1);
  });

  test("offers the path as it is on disk, keeping the quote style", () => {
    const [double] = lint('\tinclude "a.i"', facts({ "a.i": "A.i" }));
    expect(double.suggestion?.replacement?.trim()).toBe('include "A.i"');
    const [single] = lint("\tinclude 'a.i'", facts({ "a.i": "A.i" }));
    expect(single.suggestion?.replacement?.trim()).toBe("include 'A.i'");
    expect(double.suggestion?.applicability).toBe("safe");
  });

  test("the fix applies", () => {
    const source = fixture('\tinclude "hardware.i"\nstart:\n\trts');
    const result = applyFixes(
      source,
      (text) =>
        lintSource(
          text,
          { processors: ["mc68000"] },
          undefined,
          undefined,
          undefined,
          facts({ "hardware.i": "Hardware.i" }),
        ),
      { accept: ["safe"] },
    );
    expect(result.output).toContain('"Hardware.i"');
    expect(result.output).not.toContain('"hardware.i"');
  });

  test("covers INCBIN", () => {
    expect(
      lint('\tincbin "data.bin"', facts({ "data.bin": "Data.bin" })),
    ).toHaveLength(1);
  });

  test("says nothing about a path already in the right case", () => {
    expect(lint('\tinclude "a.i"', facts({ "a.i": "a.i" }))).toHaveLength(0);
  });

  test("says nothing about a path with no entry", () => {
    expect(lint('\tinclude "a.i"', facts({ "b.i": "B.i" }))).toHaveLength(0);
  });

  test("says nothing when the file system was not consulted", () => {
    expect(lint('\tinclude "a.i"')).toHaveLength(0);
    expect(lint('\tinclude "a.i"', {})).toHaveLength(0);
  });

  test("reports each include that differs, and only those", () => {
    const found = lint(
      ['\tinclude "a.i"', '\tinclude "b.i"', '\tinclude "c.i"'].join("\n"),
      facts({ "a.i": "A.i", "c.i": "C.i" }),
    );
    expect(found).toHaveLength(2);
  });

  test("ignores directives that are not file paths", () => {
    expect(lint('\tdc.b "a.i"', facts({ "a.i": "A.i" }))).toHaveLength(0);
  });
});
