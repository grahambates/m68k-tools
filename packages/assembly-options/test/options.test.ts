import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  findAssemblyConfig,
  findAssemblyConfigSync,
  searchPaths,
  loadAssemblyOptions,
  mergeOptions,
  optionsFromVasmArgs,
  vasmArgs,
} from "../src/index";

describe("optionsFromVasmArgs", () => {
  it("reads -nocase", () => {
    expect(optionsFromVasmArgs(["-nocase"]).caseSensitive).toBe(false);
  });

  it("says nothing about case otherwise", () => {
    expect(optionsFromVasmArgs(["-Fhunkexe"]).caseSensitive).toBeUndefined();
  });

  it("reads include paths in both spellings, taking relative ones from the base", () => {
    expect(
      optionsFromVasmArgs(["-I../shared", "-I", "/abs/ndk"], "/work/proj")
        .includePaths,
    ).toEqual([resolve("/work/shared"), resolve("/abs/ndk")]);
  });

  it("reads processors", () => {
    expect(optionsFromVasmArgs(["-m68020", "-mcpu32"]).processors).toEqual([
      "mc68020",
      "mccpu32",
    ]);
  });

  it("ignores what it does not know", () => {
    expect(optionsFromVasmArgs(["-o", "out", "-x", "-m68851"])).toEqual({});
  });
});

describe("mergeOptions", () => {
  it("lets a later layer win field by field", () => {
    expect(
      mergeOptions(
        { processors: ["mc68000"], caseSensitive: false },
        { processors: ["mc68020"] },
      ),
    ).toEqual({ processors: ["mc68020"], caseSensitive: false });
  });

  it("does not let an unset field cancel one that is set", () => {
    expect(
      mergeOptions({ caseSensitive: false }, { caseSensitive: undefined }),
    ).toEqual({ caseSensitive: false });
  });

  it("joins include paths, earlier first, each once", () => {
    expect(
      mergeOptions(
        { includePaths: ["/a", "/b"] },
        { includePaths: ["/b", "/c"] },
      ).includePaths,
    ).toEqual(["/a", "/b", "/c"]);
  });

  it("is empty for nothing", () => {
    expect(mergeOptions()).toEqual({});
    expect(mergeOptions({}, {})).toEqual({});
  });
});

describe("vasmArgs", () => {
  it("keeps the arguments the user gave, first", () => {
    expect(vasmArgs({}, ["-Fhunkexe", "-quiet"])).toEqual([
      "-Fhunkexe",
      "-quiet",
    ]);
  });

  it("adds include paths, processors and -nocase from the options", () => {
    expect(
      vasmArgs({
        includePaths: ["../ndk"],
        processors: ["mc68020"],
        caseSensitive: false,
      }),
    ).toEqual(["-I../ndk", "-m68020", "-nocase"]);
  });

  it("does not add -nocase when case is kept", () => {
    expect(vasmArgs({ caseSensitive: true })).toEqual([]);
    expect(vasmArgs({})).toEqual([]);
  });

  it("does not repeat what is already there", () => {
    expect(
      vasmArgs(
        {
          includePaths: ["../ndk", "/other"],
          processors: ["mc68020"],
          caseSensitive: false,
        },
        ["-nocase", "-m68020", "-I../ndk", "-I", "/other"],
      ),
    ).toEqual(["-nocase", "-m68020", "-I../ndk", "-I", "/other"]);
  });

  it("round-trips: the arguments it makes give the options back", () => {
    const options = {
      includePaths: [resolve("/a"), resolve("/b")],
      processors: ["mc68030"],
      caseSensitive: false,
    };
    expect(optionsFromVasmArgs(vasmArgs(options))).toEqual(options);
  });
});

describe("the project config file", () => {
  async function project(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), "m68k-assembly-options-"));
    for (const [name, text] of Object.entries(files)) {
      await mkdir(join(dir, name, ".."), { recursive: true });
      await writeFile(join(dir, name), text, "utf8");
    }
    return dir;
  }

  it("is found by walking up", async () => {
    const dir = await project({
      ".m68krc.json": "{}",
      "src/deep/main.s": "",
    });
    expect(await findAssemblyConfig(join(dir, "src", "deep"))).toBe(
      join(dir, ".m68krc.json"),
    );
  });

  it("is found the same way without waiting", async () => {
    const dir = await project({
      ".m68krc.json": "{}",
      "src/deep/main.s": "",
    });
    expect(findAssemblyConfigSync(join(dir, "src", "deep"))).toBe(
      join(dir, ".m68krc.json"),
    );
  });

  it("is not found where there is none", async () => {
    const dir = await project({ "a/b.s": "" });
    // Nothing between here and the file system root has one, unless the machine does.
    const found = await findAssemblyConfig(join(dir, "a"));
    expect(found === undefined || !found.startsWith(dir)).toBe(true);
  });

  it("gives the shared keys, taking relative paths from its directory", async () => {
    const dir = await project({
      ".m68krc.json": JSON.stringify({
        processors: ["mc68020"],
        includePaths: ["../shared", "/abs"],
        caseSensitive: false,
      }),
    });
    const { options, warnings } = await loadAssemblyOptions(
      join(dir, ".m68krc.json"),
    );
    expect(options).toEqual({
      processors: ["mc68020"],
      includePaths: [resolve(dir, "../shared"), resolve("/abs")],
      caseSensitive: false,
    });
    expect(warnings).toEqual([]);
  });

  it("takes a relative -I in the vasm arguments from the source root", async () => {
    const dir = await project({
      ".m68krc.json": JSON.stringify({
        sourceRoot: "build",
        vasm: { args: ["-Iinc"] },
      }),
    });
    const { options } = await loadAssemblyOptions(join(dir, ".m68krc.json"));
    expect(options.includePaths).toEqual([resolve(dir, "build", "inc")]);
  });

  it("reads -esc from the vasm arguments, and the key over it", async () => {
    const dir = await project({
      ".m68krc.json": JSON.stringify({ vasm: { args: ["-esc"] } }),
    });
    const loaded = await loadAssemblyOptions(join(dir, ".m68krc.json"));
    expect(loaded.options.escapeSequences).toBe(true);

    const off = await project({
      ".m68krc.json": JSON.stringify({
        escapeSequences: false,
        vasm: { args: ["-esc"] },
      }),
    });
    const conflict = await loadAssemblyOptions(join(off, ".m68krc.json"));
    expect(conflict.options.escapeSequences).toBe(false);
    expect(conflict.warnings).toHaveLength(1);
  });

  it("adds -esc for the option, once", () => {
    expect(vasmArgs({ escapeSequences: true })).toEqual(["-esc"]);
    expect(vasmArgs({ escapeSequences: true }, ["-esc"])).toEqual(["-esc"]);
    expect(vasmArgs({ escapeSequences: false })).toEqual([]);
  });

  it("takes the source root from its directory", async () => {
    const dir = await project({
      ".m68krc.json": JSON.stringify({ sourceRoot: "src" }),
    });
    const { options } = await loadAssemblyOptions(join(dir, ".m68krc.json"));
    expect(options).toEqual({ sourceRoot: resolve(dir, "src") });
  });

  it("searches the source root before the include paths, each once", () => {
    expect(searchPaths(["/a", "/root", "/b"], "/root")).toEqual([
      "/root",
      "/a",
      "/b",
    ]);
    expect(searchPaths(["/a"])).toEqual(["/a"]);
  });

  it("leaves the tool's own keys alone, and never fails on them", async () => {
    const dir = await project({
      ".m68krc.json": JSON.stringify({
        format: { case: "lower" },
        inlayHints: { enabled: true },
        somethingNew: 1,
        caseSensitive: false,
      }),
    });
    const { options } = await loadAssemblyOptions(join(dir, ".m68krc.json"));
    expect(options).toEqual({ caseSensitive: false });
  });

  it("takes what the vasm arguments imply when the keys are not set", async () => {
    const dir = await project({
      ".m68krc.json": JSON.stringify({
        vasm: { args: ["-nocase", "-Iinc", "-m68030"] },
      }),
    });
    const { options } = await loadAssemblyOptions(join(dir, ".m68krc.json"));
    expect(options).toEqual({
      caseSensitive: false,
      includePaths: [resolve(dir, "inc")],
      processors: ["mc68030"],
    });
  });

  it("prefers a key set outright to the arguments, and says so when they disagree", async () => {
    const dir = await project({
      ".m68krc.json": JSON.stringify({
        caseSensitive: true,
        vasm: { args: ["-nocase"] },
      }),
    });
    const { options, warnings } = await loadAssemblyOptions(
      join(dir, ".m68krc.json"),
    );
    expect(options.caseSensitive).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("-nocase");
  });

  it("ignores a shared key of the wrong type", async () => {
    const dir = await project({
      ".m68krc.json": JSON.stringify({
        processors: "mc68000",
        includePaths: [1, 2],
        caseSensitive: "no",
      }),
    });
    const { options } = await loadAssemblyOptions(join(dir, ".m68krc.json"));
    expect(options).toEqual({});
  });

  it("rejects a file that is not a JSON object", async () => {
    const dir = await project({ ".m68krc.json": "[]" });
    await expect(
      loadAssemblyOptions(join(dir, ".m68krc.json")),
    ).rejects.toThrow("JSON object");
    const bad = await project({ ".m68krc.json": "{ nope" });
    await expect(
      loadAssemblyOptions(join(bad, ".m68krc.json")),
    ).rejects.toThrow();
  });
});
