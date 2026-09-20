import {
  findVasmInclude,
  includeArguments,
  vasmSearchDirectories,
} from "../src/index";

const files = (...paths: string[]) => {
  const set = new Set(paths);
  return (path: string) => set.has(path);
};

describe("vasmSearchDirectories", () => {
  it("is the run directory, the main source's, the -I paths, then incdirs", () => {
    expect(
      vasmSearchDirectories({
        cwd: "/p",
        mainDir: "/p/src",
        includePaths: ["/ndk"],
        incDirs: ["/more"],
      }),
    ).toEqual(["/p", "/p/src", "/ndk", "/more"]);
  });

  it("tries a relative path from the run directory and then the main source's", () => {
    expect(
      vasmSearchDirectories({
        cwd: "/p",
        mainDir: "/p/src",
        includePaths: ["inc"],
        incDirs: ["../lib"],
      }),
    ).toEqual(["/p", "/p/src", "/p/inc", "/p/src/inc", "/lib", "/p/lib"]);
  });

  it("names each directory once", () => {
    expect(vasmSearchDirectories({ cwd: "/p", mainDir: "/p" })).toEqual(["/p"]);
  });
});

describe("findVasmInclude", () => {
  const search = { cwd: "/p", mainDir: "/p/src" };

  it("finds a path from the run directory", () => {
    expect(findVasmInclude("lib/a.i", search, files("/p/lib/a.i"))).toBe(
      "/p/lib/a.i",
    );
  });

  it("finds a file beside the main source", () => {
    expect(findVasmInclude("c.i", search, files("/p/src/c.i"))).toBe(
      "/p/src/c.i",
    );
  });

  it("does not look beside the including file", () => {
    // lib/a.i is only in lib, where nothing in the search looks.
    expect(findVasmInclude("b.i", search, files("/p/lib/b.i"))).toBeUndefined();
  });

  it("finds a relative -I from either directory", () => {
    const found = findVasmInclude(
      "e.i",
      { ...search, includePaths: ["../inc"] },
      files("/p/inc/e.i"),
    );
    // From the main source's directory: /p/src/../inc.
    expect(found).toBe("/p/inc/e.i");
  });

  it("takes an absolute name as it is", () => {
    expect(findVasmInclude("/x/a.i", search, files("/x/a.i"))).toBe("/x/a.i");
  });
});

describe("includeArguments", () => {
  it("reads both spellings, in order", () => {
    expect(includeArguments(["-Ia", "-nocase", "-I", "b", "-Fbin"])).toEqual([
      "a",
      "b",
    ]);
  });
});
