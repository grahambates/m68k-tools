import { vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  collectInitAnswers,
  describeInitConfig,
  detectSourceGlobs,
  normalizeIgnoreGlobs,
  renderInitConfig,
  schemaUrl,
  validateProcessors,
  terminalPrompt,
  type InitAnswers,
  type Prompt,
} from "../cli/init.js";

/** Drives the questions in order, so the flow is testable without a terminal. */
function scriptedPrompt(answers: string[]): Prompt {
  let next = 0;
  const take = () => answers[next++];
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async choice(_question, _choices, fallback) {
      const answer = take();
      return (
        answer === undefined || answer === "" ? fallback : answer
      ) as typeof fallback;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async list(_question, fallback) {
      const answer = take();
      if (answer === undefined || answer === "") return [...fallback];
      return answer.split(",").map((value) => value.trim());
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async confirm(_question, fallback) {
      const answer = take();
      return answer === undefined || answer === ""
        ? fallback
        : /^y/i.test(answer);
    },
  };
}

const base: InitAnswers = {
  platform: "generic",
  processors: ["mc68000"],
  goal: "balanced",
  style: false,
  files: [],
  ignores: [],
};

describe("m68k-lint --init", () => {
  test("accepting every default writes only the schema reference", () => {
    // A config restating the defaults is noise, and pins behaviour never chosen.
    expect(renderInitConfig(base)).toBe(
      `{\n  "$schema": "${schemaUrl()}"\n}\n`,
    );
  });

  test("writes only what differs from the defaults", () => {
    const config = JSON.parse(
      renderInitConfig({
        platform: "amiga",
        processors: ["mc68000", "mc68020"],
        goal: "size",
        style: true,
        files: ["src/**"],
        ignores: ["vendor/**"],
      }),
    ) as Record<string, unknown>;

    expect(config).toEqual({
      $schema: schemaUrl(),
      platform: "amiga",
      processors: ["mc68000", "mc68020"],
      goal: "size",
      presets: ["recommended", "style"],
      files: ["src/**"],
      ignores: ["vendor/**"],
    });
  });

  test("collects answers in order and falls back on empty input", async () => {
    const prompt = scriptedPrompt([
      "amiga",
      "mc68000,mc68020",
      "",
      "y",
      "src/**",
      "vendor",
    ]);
    const answers = await collectInitAnswers(prompt, ["**"]);
    expect(answers).toEqual({
      platform: "amiga",
      processors: ["mc68000", "mc68020"],
      goal: "balanced",
      style: true,
      files: ["src/**"],
      ignores: ["vendor"],
    });
  });

  test("uses the detected source globs when the answer is left blank", async () => {
    const answers = await collectInitAnswers(
      scriptedPrompt(["", "", "", "", "", ""]),
      ["asm/**"],
    );
    expect(answers.files).toEqual(["asm/**"]);
    expect(answers.platform).toBe("generic");
  });

  test("gives a bare directory the trailing glob it needs to match anything", () => {
    // `vendor` on its own matches no file, and does so silently.
    expect(
      normalizeIgnoreGlobs(["vendor", "generated/", "build/**", "*.tmp"]),
    ).toEqual(["vendor/**", "generated/**", "build/**", "*.tmp"]);
  });

  test("rejects an unknown processor rather than writing it", () => {
    expect(() => validateProcessors(["mc68000", "mc68050"])).toThrow(/mc68050/);
    expect(() => validateProcessors([])).toThrow(/at least one/i);
    expect(validateProcessors(["mc68030"])).toEqual(["mc68030"]);
  });

  describe("source glob detection", () => {
    const tree = async (files: string[]) => {
      const root = await mkdtemp(join(tmpdir(), "m68k-lint-init-"));
      for (const file of files) {
        await mkdir(join(root, dirname(file)), { recursive: true });
        await writeFile(join(root, file), "\tnop\n");
      }
      return root;
    };

    test("an empty project falls back to everything", async () => {
      expect(await detectSourceGlobs(await tree([]))).toEqual(["**"]);
    });

    test("sources in the project root suggest everything", async () => {
      // A common layout, and a narrower glob would silently miss these.
      expect(
        await detectSourceGlobs(await tree(["main.s", "sprite.asm"])),
      ).toEqual(["**"]);
    });

    test("sources only in the root win even when subdirectories exist", async () => {
      expect(
        await detectSourceGlobs(await tree(["main.s", "lib/helper.s"])),
      ).toEqual(["**"]);
    });

    test("sources confined to subdirectories suggest those", async () => {
      expect(
        await detectSourceGlobs(await tree(["src/main.s", "lib/helper.i"])),
      ).toEqual(["lib/**", "src/**"]);
    });

    test("finds sources nested well below a subdirectory", async () => {
      expect(
        await detectSourceGlobs(await tree(["game/code/level/one.s"])),
      ).toEqual(["game/**"]);
    });

    test("ignores directories that only hold other things", async () => {
      // Detection is by file, not by directory name.
      expect(
        await detectSourceGlobs(await tree(["src/main.s", "docs/readme.md"])),
      ).toEqual(["src/**"]);
    });

    test("skips build output and dot directories", async () => {
      const root = await tree([
        "dist/generated.s",
        ".cache/x.s",
        "node_modules/pkg/y.s",
      ]);
      expect(await detectSourceGlobs(root)).toEqual(["**"]);
    });
  });

  test("summarises what the config turns on", () => {
    expect(
      describeInitConfig({ ...base, platform: "atari", style: true }),
    ).toBe("platform atari, cpu mc68000, goal balanced, style preset on");
  });

  test("terminal prompt parses answers and honours blank input", async () => {
    const asked: string[] = [];
    const replies = ["", "amiga", "", "src/**, vendor/**", "y", "n", ""];
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
        "Target platform",
        ["generic", "amiga"] as const,
        "generic",
      ),
    ).toBe("generic");
    expect(
      await prompt.choice(
        "Target platform",
        ["generic", "amiga"] as const,
        "generic",
      ),
    ).toBe("amiga");
    expect(await prompt.list("Source globs", ["**"])).toEqual(["**"]);
    expect(await prompt.list("Source globs", ["**"])).toEqual([
      "src/**",
      "vendor/**",
    ]);
    expect(await prompt.confirm("Style?", false)).toBe(true);
    expect(await prompt.confirm("Style?", true)).toBe(false);
    expect(await prompt.confirm("Style?", true)).toBe(true);

    // The default is shown, so an empty answer is an informed choice.
    expect(asked[0]).toBe("Target platform (generic, amiga) [generic]: ");
    expect(asked[4]).toBe("Style? [y/N]: ");
    expect(asked[5]).toBe("Style? [Y/n]: ");
  });

  test("terminal prompt re-asks until a choice is valid", async () => {
    const replies = ["nonsense", "atari"];
    let next = 0;
    // eslint-disable-next-line @typescript-eslint/require-await
    const rl = { question: async () => replies[next++] ?? "" };
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect(
        await terminalPrompt(rl).choice(
          "Platform",
          ["generic", "atari"] as const,
          "generic",
        ),
      ).toBe("atari");
      expect(error).toHaveBeenCalledWith("  Expected one of: generic, atari");
    } finally {
      error.mockRestore();
    }
  });
});
