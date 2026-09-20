import {
  includeArguments,
  resolveInclude,
  vasmSearchDirectories,
} from "../src/index";

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

describe("includeArguments", () => {
  it("reads both spellings, in order", () => {
    expect(includeArguments(["-Ia", "-nocase", "-I", "b", "-Fbin"])).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("resolveInclude", () => {
  const fs = (...paths: string[]) => {
    const set = new Set(paths);
    return (dir: string, name: string) => {
      const path = `${dir}/${name}`;
      return Promise.resolve(set.has(path) ? path : undefined);
    };
  };
  const search = { cwd: "/p", mainDir: "/p/src" };

  it("takes what vasm would find first", async () => {
    const found = await resolveInclude(
      "a.i",
      [search],
      ["/p/lib"],
      fs("/p/src/a.i", "/p/lib/a.i"),
    );
    expect(found).toEqual({ path: "/p/src/a.i", dir: "/p/src", via: "vasm" });
  });

  it("falls back, and says that vasm would not find it", async () => {
    const found = await resolveInclude(
      "b.i",
      [search],
      ["/p/lib"],
      fs("/p/lib/b.i"),
    );
    expect(found).toEqual({
      path: "/p/lib/b.i",
      dir: "/p/lib",
      via: "fallback",
    });
  });

  it("tries each search in turn before the fallback", async () => {
    const found = await resolveInclude(
      "c.i",
      [search, { cwd: "/q", mainDir: "/q/src" }],
      ["/p/lib"],
      fs("/q/src/c.i", "/p/lib/c.i"),
    );
    expect(found).toMatchObject({ path: "/q/src/c.i", via: "vasm" });
  });

  it("does not look beside the including file unless given it as a fallback", async () => {
    // lib/b.i is only in lib, where nothing in vasm's search looks.
    expect(
      await resolveInclude("b.i", [search], [], fs("/p/lib/b.i")),
    ).toBeUndefined();
  });

  it("tries a relative -I from the run directory and then the main source's", async () => {
    const found = await resolveInclude(
      "e.i",
      [{ ...search, includePaths: ["../inc"] }],
      [],
      fs("/p/inc/e.i"),
    );
    // Not /p/../inc, but /p/src/../inc.
    expect(found).toMatchObject({ path: "/p/inc/e.i", via: "vasm" });
  });

  it("takes an absolute name as it is", async () => {
    const find = (dir: string, name: string) =>
      Promise.resolve(name === "/x/a.i" ? name : undefined);
    expect(await resolveInclude("/x/a.i", [search], [], find)).toMatchObject({
      path: "/x/a.i",
    });
  });

  it("finds nothing where nothing is", async () => {
    expect(
      await resolveInclude("d.i", [search], ["/p/lib"], fs()),
    ).toBeUndefined();
  });
});
