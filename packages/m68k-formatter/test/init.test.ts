import { vi } from "vitest";
import {
  collectInitAnswers,
  describeInitConfig,
  renderInitConfig,
  terminalPrompt,
  type InitAnswers,
  type Prompt,
} from "../src/cli/init";

/** Drives the questions in order, so the flow is testable without a terminal. */
function scriptedPrompt(answers: string[]): Prompt {
  let next = 0;
  const take = () => answers[next++];
  return {
    choice(_question, _choices, fallback) {
      const answer = take();
      return Promise.resolve(
        (answer === undefined || answer === ""
          ? fallback
          : answer) as typeof fallback,
      );
    },
    confirm(_question, fallback) {
      const answer = take();
      return Promise.resolve(
        answer === undefined || answer === "" ? fallback : /^y/i.test(answer),
      );
    },
  };
}

const base: InitAnswers = {
  case: "lower",
  labelColon: "on",
  quotes: "double",
  operandSpace: "off",
  indentStyle: "space",
  trimWhitespace: false,
  finalNewLine: true,
  endOfLine: "lf",
};

describe("m68k-format --init", () => {
  test("accepting every default writes an empty config", () => {
    // A config restating the defaults is noise, and pins behaviour never chosen.
    expect(renderInitConfig(base)).toBe(`{}\n`);
  });

  test("writes only what differs from the defaults", () => {
    const config = JSON.parse(
      renderInitConfig({
        case: "upper",
        labelColon: "off",
        quotes: "single",
        operandSpace: "on",
        indentStyle: "tab",
        trimWhitespace: true,
        finalNewLine: false,
        endOfLine: "crlf",
      }),
    ) as Record<string, unknown>;

    expect(config).toEqual({
      case: "upper",
      labelColon: "off",
      quotes: "single",
      operandSpace: "on",
      align: { indentStyle: "tab" },
      trimWhitespace: true,
      finalNewLine: false,
      endOfLine: "crlf",
    });
  });

  test("collects answers in order and falls back on empty input", async () => {
    const prompt = scriptedPrompt([
      "upper",
      "off",
      "single",
      "on",
      "tab",
      "y",
      "n",
      "crlf",
    ]);
    const answers = await collectInitAnswers(prompt);
    expect(answers).toEqual({
      case: "upper",
      labelColon: "off",
      quotes: "single",
      operandSpace: "on",
      indentStyle: "tab",
      trimWhitespace: true,
      finalNewLine: false,
      endOfLine: "crlf",
    });
  });

  test("uses the library defaults when every answer is left blank", async () => {
    const answers = await collectInitAnswers(
      scriptedPrompt(["", "", "", "", "", "", "", ""]),
    );
    expect(answers).toEqual(base);
  });

  test("summarises what the config turns on", () => {
    expect(describeInitConfig({ ...base, case: "upper" })).toBe(
      "case upper, labelColon on, quotes double, operandSpace off, indentStyle space, endOfLine lf",
    );
  });

  test("terminal prompt parses answers and honours blank input", async () => {
    const asked: string[] = [];
    const replies = ["", "y", "n", ""];
    let next = 0;
    const rl = {
      question: (query: string) => {
        asked.push(query);
        return Promise.resolve(replies[next++] ?? "");
      },
    };
    const prompt = terminalPrompt(rl);

    expect(
      await prompt.choice(
        "Quote style",
        ["double", "single"] as const,
        "double",
      ),
    ).toBe("double");
    expect(await prompt.confirm("Trim?", false)).toBe(true);
    expect(await prompt.confirm("Trim?", true)).toBe(false);
    expect(await prompt.confirm("Trim?", true)).toBe(true);

    // The default is shown, so an empty answer is an informed choice.
    expect(asked[0]).toBe("Quote style (double, single) [double]: ");
    expect(asked[1]).toBe("Trim? [y/N]: ");
    expect(asked[2]).toBe("Trim? [Y/n]: ");
  });

  test("terminal prompt re-asks until a choice is valid", async () => {
    const replies = ["nonsense", "single"];
    let next = 0;
    const rl = { question: () => Promise.resolve(replies[next++] ?? "") };
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect(
        await terminalPrompt(rl).choice(
          "Quote style",
          ["double", "single"] as const,
          "double",
        ),
      ).toBe("single");
      expect(error).toHaveBeenCalledWith("  Expected one of: double, single");
    } finally {
      error.mockRestore();
    }
  });
});
