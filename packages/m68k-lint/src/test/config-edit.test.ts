import {
  addIgnoreToConfigText,
  configIgnores,
  isIgnored,
  newConfigText,
} from "../cli/project-config.js";

const edit = (text: string, entry = "sys/hw.i") =>
  addIgnoreToConfigText(text, entry);
const ignoresOf = (text: string | undefined) =>
  (JSON.parse(text ?? "{}") as { ignores?: string[] }).ignores;

describe("addIgnoreToConfigText", () => {
  test("appends to a list on one line, in the same style", () => {
    const text = '{\n  "ignores": ["generated/**"]\n}\n';
    const out = edit(text);
    expect(out).toBe('{\n  "ignores": ["generated/**", "sys/hw.i"]\n}\n');
  });

  test("appends to a list spread over lines, matching its indentation", () => {
    const text =
      '{\n  "ignores": [\n    "generated/**",\n    "vendor/**"\n  ]\n}\n';
    expect(edit(text)).toBe(
      '{\n  "ignores": [\n    "generated/**",\n    "vendor/**",\n    "sys/hw.i"\n  ]\n}\n',
    );
  });

  test("fills an empty list", () => {
    expect(edit('{ "ignores": [] }')).toBe('{ "ignores": ["sys/hw.i"] }');
    expect(edit('{\n  "ignores": [\n  ]\n}')).toBe(
      '{\n  "ignores": ["sys/hw.i"]\n}',
    );
  });

  test("adds the list after the last property when there is none", () => {
    const text = '{\n  "platform": "amiga",\n  "processors": ["mc68000"]\n}\n';
    const out = edit(text);
    expect(out).toBe(
      '{\n  "platform": "amiga",\n  "processors": ["mc68000"],\n  "ignores": ["sys/hw.i"]\n}\n',
    );
  });

  test("leaves the rest of the file exactly as it was", () => {
    const text =
      '{\n    "processors": ["mc68000", "mc68020"],\n    "rules": { "suspicious/nop": "off" }\n}\n';
    const out = edit(text) ?? "";
    expect(out.startsWith(text.slice(0, text.lastIndexOf("\n}")))).toBe(true);
    expect(JSON.parse(out)).toMatchObject({
      processors: ["mc68000", "mc68020"],
      rules: { "suspicious/nop": "off" },
      ignores: ["sys/hw.i"],
    });
  });

  test("uses a compact layout for a compact file", () => {
    expect(edit('{"platform":"amiga"}')).toBe(
      '{"platform":"amiga", "ignores": ["sys/hw.i"]}',
    );
  });

  test("fills an empty object", () => {
    expect(edit("{}\n")).toBe('{\n  "ignores": ["sys/hw.i"]\n}\n');
    expect(ignoresOf(edit("{\n}"))).toEqual(["sys/hw.i"]);
  });

  test("uses the older name if that is the one the file has", () => {
    const out = edit('{\n  "ignorePatterns": ["a/**"]\n}\n') ?? "";
    expect(JSON.parse(out)).toEqual({ ignorePatterns: ["a/**", "sys/hw.i"] });
  });

  test("is unchanged when the entry is already listed", () => {
    const text = '{ "ignores": ["sys/hw.i"] }';
    expect(edit(text)).toBe(text);
  });

  test("escapes what JSON needs escaped", () => {
    const out = edit("{}", 'odd "name"\\file.s');
    expect(ignoresOf(out)).toEqual(['odd "name"\\file.s']);
  });

  test("copes with strings that look like structure", () => {
    const text =
      '{\n  "note": "has ] and } and \\" in it",\n  "ignores": ["a"]\n}\n';
    expect(ignoresOf(edit(text))).toEqual(["a", "sys/hw.i"]);
  });

  test("declines what it cannot edit safely", () => {
    expect(edit("not json")).toBeUndefined();
    expect(edit("[]")).toBeUndefined();
    expect(edit('{ "ignores": "sys/**" }')).toBeUndefined();
    expect(edit('{ "ignores": ')).toBeUndefined();
  });
});

describe("newConfigText", () => {
  test("is a config that ignores the file and nothing else", () => {
    const text = newConfigText("sys/hw.i");
    expect(JSON.parse(text)).toEqual({ ignores: ["sys/hw.i"] });
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("isIgnored", () => {
  test("matches the patterns", () => {
    expect(isIgnored("sys/hw.i", ["sys/**"])).toBe(true);
    expect(isIgnored("src/main.s", ["sys/**"])).toBe(false);
    expect(isIgnored("sys/hw.i", ["sys/hw.i"])).toBe(true);
  });

  test("reads a leading ./ as the pattern's root", () => {
    expect(isIgnored("sys/hw.i", ["./sys/**"])).toBe(true);
  });

  test("always ignores node_modules and .git", () => {
    expect(isIgnored("node_modules/x/a.s", [])).toBe(true);
    expect(isIgnored(".git/hooks/a.s", [])).toBe(true);
  });

  test("matches dotfiles", () => {
    expect(isIgnored(".hidden/a.s", [".hidden/**"])).toBe(true);
  });
});

describe("configIgnores", () => {
  test("reads either name", () => {
    expect(configIgnores({ ignores: ["a"] })).toEqual(["a"]);
    expect(configIgnores({ ignorePatterns: ["b"] })).toEqual(["b"]);
    expect(configIgnores({})).toEqual([]);
  });
});
