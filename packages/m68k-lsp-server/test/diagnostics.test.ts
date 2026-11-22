import { parseBlocks, parseFile } from "m68k-parser";
import { DiagnosticSeverity } from "vscode-languageserver";
import DiagnosticProcessor, { parseVasmOutput } from "../src/diagnostics";
import { createTestContext } from "./helpers";

describe("diagnostics", () => {
  describe("parseVasmOutput", () => {
    it("parses an empty string with no errors", () => {
      const result = parseVasmOutput("");
      expect(result).toHaveLength(0);
    });

    it("parses no-line errors", () => {
      const output =
        "fatal error 13: could not open <example.s> for input\naborting...";
      const result = parseVasmOutput(output);

      expect(result).toHaveLength(1);

      expect(result[0].code).toBe(13);
      expect(result[0].message).toBe("could not open <example.s> for input");
      expect(result[0].source).toBe("vasm");
      expect(result[0].severity).toBe(DiagnosticSeverity.Error);
      expect(result[0].range).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      });
    });

    it("parses line error output", () => {
      const output = `
error 2 in line 9 of "example.s": unknown mnemonic <dsfsdf>
>            dsfsdf

fatal error 2001 in line 10 of "example.s": instruction not supported on selected architecture
>            muls.l d0,d1
aborting...
      `;
      const result = parseVasmOutput(output);

      expect(result).toHaveLength(2);

      expect(result[0].code).toBe(2);
      expect(result[0].message).toBe("unknown mnemonic <dsfsdf>");
      expect(result[0].source).toBe("vasm");
      expect(result[0].severity).toBe(DiagnosticSeverity.Error);
      expect(result[0].range).toEqual({
        start: { line: 8, character: 12 },
        end: { line: 8, character: 18 },
      });

      expect(result[1].code).toBe(2001);
      expect(result[1].message).toBe(
        "instruction not supported on selected architecture",
      );
      expect(result[1].source).toBe("vasm");
      expect(result[1].severity).toBe(DiagnosticSeverity.Error);
      expect(result[1].range).toEqual({
        start: { line: 9, character: 12 },
        end: { line: 9, character: 24 },
      });
    });

    it("parses multi-line errors", () => {
      const output = `
error 9 in line 1 of "STAT_SVZC": instruction not supported on selected architecture
called from line 798 of "example.s"
>	move.w	ccr,StatusSZ				[06]

error 2 in line 1 of "a.i": unknown mnemonic <sdsdffd>
	included from line 1 of "b.i"
	included from line 9 of "example.s"
>            sdsdffd
`;

      const result = parseVasmOutput(output);

      expect(result).toHaveLength(2);

      expect(result[0].code).toBe(9);
      expect(result[0].message).toBe(
        `error 9 in line 1 of "STAT_SVZC": instruction not supported on selected architecture`,
      );
      expect(result[0].source).toBe("vasm");
      expect(result[0].severity).toBe(DiagnosticSeverity.Error);
      expect(result[0].range).toEqual({
        start: { line: 797, character: 1 },
        end: { line: 797, character: 28 },
      });

      expect(result[1].code).toBe(2);
      expect(result[1].message).toBe(
        `error 2 in line 1 of "a.i": unknown mnemonic <sdsdffd>
	included from line 1 of "b.i"`,
      );
      expect(result[1].source).toBe("vasm");
      expect(result[1].severity).toBe(DiagnosticSeverity.Error);
      expect(result[1].range).toEqual({
        start: { line: 8, character: 12 },
        end: { line: 8, character: 19 },
      });
    });

    it("reports a message against the file that has the problem", () => {
      const output = `
error 2 in line 1 of "a.i": unknown mnemonic <sdsdffd>
	included from line 1 of "b.i"
	included from line 9 of "example.s"
>            sdsdffd
`;
      const [result] = parseVasmOutput(output, "a.i");

      // At the origin the line is the one that actually has the error, and
      // the message needs no explanation of how it was reached.
      expect(result.range.start.line).toBe(0);
      expect(result.message).toBe("unknown mnemonic <sdsdffd>");
    });

    it("reports the same message against a file part way up the chain", () => {
      const output = `
error 2 in line 1 of "a.i": unknown mnemonic <sdsdffd>
	included from line 1 of "b.i"
	included from line 9 of "example.s"
>            sdsdffd
`;
      const [result] = parseVasmOutput(output, "b.i");

      expect(result.range.start.line).toBe(0);
      expect(result.message).toContain('error 2 in line 1 of "a.i"');
    });

    it("leaves out a message belonging to another file", () => {
      const output = `
error 2 in line 1 of "a.i": unknown mnemonic <sdsdffd>
>            sdsdffd
`;
      expect(parseVasmOutput(output, "unrelated.s")).toHaveLength(0);
    });

    it("matches a reported name against a full path", () => {
      const output = `
error 2 in line 3 of "defs.i": unknown mnemonic <x>
>            x
`;
      const [result] = parseVasmOutput(output, "/work/proj/defs.i");
      expect(result.range.start.line).toBe(2);
    });

    it("keeps a message with no location whatever the target", () => {
      const output = "fatal error 13: could not open <example.s> for input";
      const [result] = parseVasmOutput(output, "anything.s");
      expect(result.message).toBe("could not open <example.s> for input");
    });

    it("sets severity level", () => {
      const output = `warning 2 in line 9 of "example.s": uh oh spaghettios`;
      const result = parseVasmOutput(output);
      expect(result[0].severity).toBe(DiagnosticSeverity.Warning);
    });
  });

  describe("#parserDiagnostics()", () => {
    const build = async (config = {}) =>
      new DiagnosticProcessor(await createTestContext(config));

    const diagnose = (processor: DiagnosticProcessor, src: string) => {
      const parsed = parseFile(src);
      return processor.parserDiagnostics(
        "untitled:test.s",
        parsed,
        parseBlocks(parsed),
      );
    };

    it("reports a syntax error with its parser code and position", async () => {
      const processor = await build({ vasm: { provideDiagnostics: true } });
      const result = diagnose(processor, "Start:\n  move.w  (a0,d0.w\n");

      const unclosed = result.find((d) => d.code === "UNCLOSED_PAREN");
      expect(unclosed).toBeTruthy();
      expect(unclosed!.severity).toBe(DiagnosticSeverity.Error);
      expect(unclosed!.source).toBe("m68k");
      // Parser lines are 1-based, language-server lines are 0-based.
      expect(unclosed!.range.start.line).toBe(1);
    });

    it("appends the parser hint to the message when there is one", async () => {
      const processor = await build({ vasm: { provideDiagnostics: true } });
      const result = diagnose(processor, "  move.w  (a0,d0.w\n");
      const unclosed = result.find((d) => d.code === "UNCLOSED_PAREN");
      expect(unclosed).toBeTruthy();
      expect(unclosed!.message).toContain("Indirect addressing requires");
    });

    it("reports nothing for valid source", async () => {
      const processor = await build({ vasm: { provideDiagnostics: true } });
      const result = diagnose(
        processor,
        "Start:\n  move.w  #$1234,d0\n  rts\n",
      );
      expect(result).toHaveLength(0);
    });

    it("does not report indexed addressing that uses equr register aliases", async () => {
      const processor = await build({ vasm: { provideDiagnostics: true } });
      // `sin equr a1` / `x equr d5` makes (sin,x) ordinary indexed addressing.
      // m68k-parser reports the names as symbols for a caller to resolve
      // rather than rejecting them (fixed in 1.5.0).
      const result = diagnose(
        processor,
        "sin\tequr\ta1\nx\tequr\td5\n  move.w\t(sin,x),d2\n",
      );
      expect(
        result.filter((d) => d.code === "MALFORMED_INDEXED_ADDRESSING"),
      ).toHaveLength(0);
    });

    it("still reports an index that cannot be a register alias", async () => {
      const processor = await build({ vasm: { provideDiagnostics: true } });
      const result = diagnose(processor, "  move.w  (a0,#5),d2\n");
      expect(
        result.filter((d) => d.code === "MALFORMED_INDEXED_ADDRESSING"),
      ).toHaveLength(1);
    });

    it("flags an instruction unsupported by the configured processor", async () => {
      const processor = await build({
        processors: ["mc68000"],
        vasm: { provideDiagnostics: false },
      });
      const result = diagnose(processor, "  bfextu d0{4:8},d1\n");

      const unsupported = result.find((d) =>
        d.message.includes("Unsupported on selected processor"),
      );
      expect(unsupported).toBeTruthy();
      expect(unsupported!.source).toBe("lsp");
      expect(unsupported!.range.start.line).toBe(0);
    });

    it("allows an instruction supported by the configured processor", async () => {
      const processor = await build({
        processors: ["mc68020"],
        vasm: { provideDiagnostics: false },
      });
      const result = diagnose(processor, "  bfextu d0{4:8},d1\n");
      expect(
        result.filter((d) => d.message.includes("Unsupported")),
      ).toHaveLength(0);
    });

    it("leaves the processor check to vasm when vasm diagnostics are on", async () => {
      const processor = await build({
        processors: ["mc68000"],
        vasm: { provideDiagnostics: true },
      });
      const result = diagnose(processor, "  bfextu d0{4:8},d1\n");
      expect(
        result.filter((d) => d.message.includes("Unsupported")),
      ).toHaveLength(0);
    });

    it("reports a block that is never terminated", async () => {
      const processor = await build({ vasm: { provideDiagnostics: true } });
      const result = diagnose(processor, "MyMacro macro\n  move.w d0,d1\n");

      const unterminated = result.find((d) => d.code === "UNTERMINATED_BLOCK");
      expect(unterminated).toBeTruthy();
      expect(unterminated!.range.start.line).toBe(0);
    });

    it("reports a terminator that closes nothing", async () => {
      const processor = await build({ vasm: { provideDiagnostics: true } });
      const result = diagnose(processor, "  move.w d0,d1\n  endm\n");
      expect(result.some((d) => d.code === "UNEXPECTED_BLOCK_TERMINATOR")).toBe(
        true,
      );
    });

    it("reports nothing for a balanced file", async () => {
      const processor = await build({ vasm: { provideDiagnostics: true } });
      const result = diagnose(
        processor,
        "MyMacro macro\n  ifeq 1\n  move.w d0,d1\n  endc\n  endm\n",
      );
      expect(result).toHaveLength(0);
    });
  });
});
