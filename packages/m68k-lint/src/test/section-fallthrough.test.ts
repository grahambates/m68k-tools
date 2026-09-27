import { defaultConfig, type LintConfig } from "../core/config.js";
import { lintSource } from "../core/lint.js";
import type { FileFacts } from "../core/facts.js";
import { fixture, lint } from "./helpers.js";

const RULE = "suspicious/section-fallthrough";
const config: LintConfig = { ...defaultConfig, measureImpact: false };

/** The lines flagged, 1-based. */
const flagged = (source: string, options: LintConfig = config) =>
  lint(source, options)
    .filter((d) => d.ruleId === RULE)
    .map((d) => d.loc.line);

/** A code section ending in `last`, followed by a data section. */
const ending = (...last: string[]) =>
  [
    "\tsection code,code",
    "start:",
    "\tmoveq #0,d0",
    ...last,
    "\tsection vars,data",
    "value:\tdc.w 0",
  ].join("\n");

describe("code running off the end of a section", () => {
  test("reports the last instruction when it falls through", () => {
    const d = lint(ending("\tmove.w d0,value"), config).find(
      (x) => x.ruleId === RULE,
    );
    expect(d).toMatchObject({
      severity: "warning",
      message: "Execution can run off the end of the code section",
      loc: { line: 4 },
    });
    expect(d?.notes?.[0]?.message).toContain("in section vars");
  });

  test.each([
    ["a conditional branch", "\tbne start"],
    ["a subroutine call", "\tbsr start"],
    ["DBcc", "\tdbf d0,start"],
  ])("%s can fall through", (_, last) => {
    expect(flagged(ending(last))).toEqual([4]);
  });

  test.each([
    ["RTS", "\trts"],
    ["RTE", "\trte"],
    ["BRA", "\tbra start"],
    ["JMP", "\tjmp start"],
    ["a computed jump", "\tjmp (a0)"],
    ["ILLEGAL", "\tillegal"],
    ["STOP", "\tstop #$2700"],
  ])("%s does not fall through", (_, last) => {
    expect(flagged(ending(last))).toEqual([]);
  });

  test("labels, comments and alignment before the switch are passed over", () => {
    expect(
      flagged(ending("\tnop", "; the end", "done:", "\teven", "size\tequ 4")),
    ).toEqual([4]);
  });

  test("data after the code in the same section is not this rule's concern", () => {
    expect(flagged(ending("\tnop", "table:\tdc.w 1,2"))).toEqual([]);
  });

  test("a switch to another code section is reported too", () => {
    expect(
      flagged(
        ["\tsection a,code", "\tnop", "\tsection b,code", "\trts"].join("\n"),
      ),
    ).toEqual([2]);
  });

  test("reopening the same section continues it", () => {
    expect(
      flagged(
        [
          "\tsection code,code",
          "\tnop",
          "\tsection vars,bss",
          "\tsection code,code",
          "\trts",
          "\tsection vars,bss",
          "buf:\tds.b 4",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a macro of plain instructions is judged by its expansion", () => {
    // Only a straight run of instructions is expanded; a body with a branch,
    // call or return stays opaque, and is covered by the silent cases below.
    const macro = ["CLEAR:\tmacro", "\tmoveq #0,\\1", "\tendm"];
    expect(flagged([...macro, ending("\tCLEAR d1")].join("\n"))).toEqual([7]);
  });

  test.each([
    ["a macro it cannot see into", ending("\tEXIT")],
    ["a line made conditional by IIF", ending("\tiif 1 rts")],
    [
      "an unknown next section",
      ending("\tnop").replace(
        "section vars,data",
        'include "vars.i"\n\tdc.w 0',
      ),
    ],
    ["unreachable code", ending("\trts", "\tnop")],
    ["a TRAP, which may be how the program exits", ending("\ttrap #1")],
  ])("stays silent for %s", (_, source) => {
    expect(flagged(source)).toEqual([]);
  });

  test.each(["generic", "atari", "amiga"] as const)(
    "runs on the %s platform",
    (platform) => {
      expect(flagged(ending("\tnop"), { ...config, platform })).toEqual([4]);
    },
  );

  describe("the end of the file", () => {
    const eof = (source: string, facts?: FileFacts) =>
      lintSource(
        fixture(source),
        config,
        undefined,
        undefined,
        undefined,
        facts,
      )
        .filter((d) => d.ruleId === RULE)
        .map((d) => [d.loc.line, d.message]);
    const source = "\tsection code,code\nstart:\n\tmoveq #0,d0\n\tnop";

    test("is reported when no file in the project includes this one", () => {
      expect(eof(source, { includedByProject: false })).toEqual([
        [4, "Execution can run off the end of the file"],
      ]);
    });

    test("with only one section and no section directive at all", () => {
      expect(
        eof("start:\n\tmove.w d0,d1", { includedByProject: false }),
      ).toEqual([[2, "Execution can run off the end of the file"]]);
    });

    test("is silent for a file the project includes", () => {
      // It continues in the file that includes it.
      expect(eof(source, { includedByProject: true })).toEqual([]);
    });

    test("is silent without a project index to say", () => {
      expect(eof(source)).toEqual([]);
      expect(eof(source, {})).toEqual([]);
    });

    test("is silent when an INCLUDE after the code continues it", () => {
      expect(
        eof(`${source}\n\tinclude "more.s"`, { includedByProject: false }),
      ).toEqual([]);
    });

    test("is silent when the code ends properly", () => {
      expect(
        eof(`${source}\n\trts\n\tsection vars,bss\nbuf:\tds.b 4`, {
          includedByProject: false,
        }),
      ).toEqual([]);
    });

    test("data after the code in another section is still the end of the code", () => {
      // The last thing assembled is data, so this is the section case, not the
      // end of the file.
      expect(
        eof(`${source}\n\tsection vars,bss\nbuf:\tds.b 4`, {
          includedByProject: false,
        }),
      ).toEqual([[4, "Execution can run off the end of the code section"]]);
    });
  });
});
