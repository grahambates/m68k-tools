import { dirname, resolve } from "node:path";
import {
  configIncludePaths,
  entryDirectories,
  followIncludes,
  includeCaseOnDisk,
  type IncludeFs,
} from "../cli/project-config.js";

/** A file system held in a map, matching names without regard to case if asked. */
function memoryFs(
  files: Record<string, string>,
  ignoreCase = false,
): IncludeFs {
  const table = new Map(
    Object.entries(files).map(([path, text]) => [resolve(path), text]),
  );
  const lookup = (path: string) => {
    if (table.has(path)) return path;
    if (!ignoreCase) return undefined;
    return [...table.keys()].find(
      (k) => k.toLowerCase() === path.toLowerCase(),
    );
  };
  return {
    read: (path) => Promise.resolve(table.get(path)),
    find: (dir, name) => Promise.resolve(lookup(resolve(dir, name))),
    list: (dir) =>
      Promise.resolve([
        ...new Set(
          [...table.keys()]
            .filter((path) => path.startsWith(dir + "/"))
            .map((path) => path.slice(dir.length + 1).split("/")[0]),
        ),
      ]),
  };
}

const paths = (files: { path: string }[]) => files.map((f) => f.path);

describe("followIncludes", () => {
  test("finds an include beside the file that names it", async () => {
    const fs = memoryFs({ "/p/hw.i": "HW equ 1" });
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tinclude "hw.i"' }],
      { includePaths: [], fs },
    );
    expect(paths(found)).toEqual([resolve("/p/hw.i")]);
    expect(found[0].source).toBe("HW equ 1");
  });

  test("finds what a nested include names from the main source's directory", async () => {
    // vasm looks in the directory of the main source, not beside the file that
    // includes: checked with vasm, lib/a.i naming "c.i" finds src/c.i there.
    const fs = memoryFs({
      "/p/lib/a.i": '\tinclude "c.i"',
      "/p/src/c.i": "C equ 1",
    });
    const found = await followIncludes(
      [
        { path: "/p/src/main.s", source: '\tinclude "../lib/a.i"' },
        { path: "/p/lib/a.i", source: '\tinclude "c.i"' },
      ],
      { includePaths: [], fs },
    );
    expect(paths(found)).toEqual([resolve("/p/src/c.i")]);
  });

  test("takes what vasm would open over a file beside the including file", async () => {
    // Both exist: vasm opens the one in the main source's directory, never the
    // one beside lib/a.i, so that is the one that is read.
    const fs = memoryFs({ "/p/src/b.i": "main dir", "/p/lib/b.i": "beside" });
    const found = await followIncludes(
      [
        { path: "/p/src/main.s", source: '\tinclude "../lib/a.i"' },
        { path: "/p/lib/a.i", source: '\tinclude "b.i"' },
      ],
      { includePaths: [], fs },
    );
    expect(found.map((f) => f.source)).toEqual(["main dir"]);
  });

  test("still reads a file only beside the including file, which vasm would not open", async () => {
    const fs = memoryFs({ "/p/lib/b.i": "beside" });
    const found = await followIncludes(
      [
        { path: "/p/src/main.s", source: '\tinclude "../lib/a.i"' },
        { path: "/p/lib/a.i", source: '\tinclude "b.i"' },
      ],
      { includePaths: [], fs },
    );
    expect(found.map((f) => f.source)).toEqual(["beside"]);
  });

  test("follows an incdir named in a source", async () => {
    // Checked with vasm: incdir "inc" then include "e.i" opens inc/e.i.
    const fs = memoryFs({ "/p/inc/e.i": "E equ 1" });
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tincdir "inc"\n\tinclude "e.i"' }],
      { includePaths: [], fs },
    );
    expect(paths(found)).toEqual([resolve("/p/inc/e.i")]);
  });

  test("an incdir in one file serves includes in another", async () => {
    const fs = memoryFs({ "/p/inc/e.i": "E equ 1" });
    const found = await followIncludes(
      [
        { path: "/p/main.s", source: '\tincdir "inc"\n\tinclude "lib/a.i"' },
        { path: "/p/lib/a.i", source: '\tinclude "e.i"' },
      ],
      { includePaths: [], fs },
    );
    expect(paths(found)).toEqual([resolve("/p/inc/e.i")]);
  });

  test("a file that is included is not taken for a main source", async () => {
    const fs = memoryFs({ "/p/lib/x.i": "X equ 1", "/p/lib/a.i": "" });
    const dirs = await entryDirectories(
      [
        { path: "/p/src/main.s", source: '\tinclude "../lib/a.i"' },
        { path: "/p/lib/a.i", source: "" },
      ],
      { includePaths: [], fs },
    );
    expect(dirs).toEqual([resolve("/p/src")]);
  });

  test("finds one through an include path, outside the project", async () => {
    const fs = memoryFs({ "/ndk/include/exec/types.i": "TRUE equ 1" });
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tinclude "exec/types.i"' }],
      { includePaths: ["/ndk/include"], fs },
    );
    expect(paths(found)).toEqual([resolve("/ndk/include/exec/types.i")]);
  });

  test("looks beside the including file before the include paths", async () => {
    const fs = memoryFs({
      "/p/hw.i": "local",
      "/ndk/hw.i": "shared",
    });
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tinclude "hw.i"' }],
      { includePaths: ["/ndk"], fs },
    );
    expect(found.map((f) => f.source)).toEqual(["local"]);
  });

  test("takes the first include path that has it, in order", async () => {
    const fs = memoryFs({ "/a/x.i": "a", "/b/x.i": "b" });
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tinclude "x.i"' }],
      { includePaths: ["/a", "/b"], fs },
    );
    expect(found.map((f) => f.source)).toEqual(["a"]);
  });

  test("follows includes of includes", async () => {
    const fs = memoryFs({
      "/ndk/exec/exec.i": '\tinclude "exec/types.i"',
      "/ndk/exec/types.i": "TRUE equ 1",
    });
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tinclude "exec/exec.i"' }],
      { includePaths: ["/ndk"], fs },
    );
    expect(paths(found)).toEqual([
      resolve("/ndk/exec/exec.i"),
      resolve("/ndk/exec/types.i"),
    ]);
  });

  test("an include of a file already in hand adds nothing", async () => {
    const fs = memoryFs({ "/p/hw.i": "HW equ 1" });
    const found = await followIncludes(
      [
        { path: "/p/main.s", source: '\tinclude "hw.i"' },
        { path: "/p/hw.i", source: "HW equ 1" },
      ],
      { includePaths: [], fs },
    );
    expect(found).toEqual([]);
  });

  test("a cycle ends", async () => {
    const fs = memoryFs({
      "/p/a.i": '\tinclude "b.i"',
      "/p/b.i": '\tinclude "a.i"',
    });
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tinclude "a.i"' }],
      { includePaths: [], fs },
    );
    expect(paths(found)).toEqual([resolve("/p/a.i"), resolve("/p/b.i")]);
  });

  test("an include that cannot be found is skipped", async () => {
    const fs = memoryFs({ "/p/real.i": "X equ 1" });
    const found = await followIncludes(
      [
        {
          path: "/p/main.s",
          source: '\tinclude "missing.i"\n\tinclude "real.i"',
        },
      ],
      { includePaths: ["/nowhere"], fs },
    );
    expect(paths(found)).toEqual([resolve("/p/real.i")]);
  });

  test("leaves case to the file system it is given", async () => {
    const fs = memoryFs({ "/ndk/Exec/Types.i": "TRUE equ 1" }, true);
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tinclude "exec/types.i"' }],
      { includePaths: ["/ndk"], fs },
    );
    expect(paths(found)).toEqual([resolve("/ndk/Exec/Types.i")]);
  });

  test("reads either quote and any case of the directive", async () => {
    const fs = memoryFs({ "/p/a.i": "1", "/p/b.i": "2", "/p/c.i": "3" });
    const found = await followIncludes(
      [
        {
          path: "/p/main.s",
          source: '\tINCLUDE \'a.i\'\n\tInclude "b.i"\nlabel: include "c.i"',
        },
      ],
      { includePaths: [], fs },
    );
    expect(found).toHaveLength(3);
  });

  test("does not follow INCBIN, which is not source", async () => {
    const fs = memoryFs({ "/p/data.bin": "bytes" });
    const found = await followIncludes(
      [{ path: "/p/main.s", source: '\tincbin "data.bin"' }],
      { includePaths: [], fs },
    );
    expect(found).toEqual([]);
  });

  test("stops at the limit", async () => {
    const fs = memoryFs({ "/p/a.i": "", "/p/b.i": "", "/p/c.i": "" });
    const found = await followIncludes(
      [
        {
          path: "/p/main.s",
          source: '\tinclude "a.i"\n\tinclude "b.i"\n\tinclude "c.i"',
        },
      ],
      { includePaths: [], fs, limit: 2 },
    );
    expect(found).toHaveLength(2);
  });
});

describe("configIncludePaths", () => {
  test("takes relative paths from the config's directory", () => {
    expect(
      configIncludePaths(
        { includePaths: ["../shared", "/abs/ndk"] },
        "/work/proj",
      ),
    ).toEqual([resolve("/work/shared"), resolve("/abs/ndk")]);
  });

  test("is empty when there are none", () => {
    expect(configIncludePaths({}, "/work/proj")).toEqual([]);
  });
});

describe("includeCaseOnDisk", () => {
  const check = (
    files: Record<string, string>,
    source: string,
    includePaths: string[] = [],
    from = "/p/main.s",
  ) =>
    includeCaseOnDisk(
      { path: from, source },
      { includePaths, fs: memoryFs(files, true) },
    );

  test("reports a file written in the wrong case", async () => {
    const found = await check(
      { "/p/Hardware.i": "" },
      '\tinclude "hardware.i"',
    );
    expect([...found]).toEqual([["hardware.i", "Hardware.i"]]);
  });

  test("reports a directory in the wrong case, keeping the rest of the path", async () => {
    const found = await check(
      { "/ndk/Exec/types.i": "" },
      '\tinclude "exec/types.i"',
      ["/ndk"],
    );
    expect([...found]).toEqual([["exec/types.i", "Exec/types.i"]]);
  });

  test("reports each segment that differs", async () => {
    const found = await check(
      { "/ndk/Exec/Types.i": "" },
      '\tinclude "exec/types.i"',
      ["/ndk"],
    );
    expect(found.get("exec/types.i")).toBe("Exec/Types.i");
  });

  test("says nothing about a path in the right case", async () => {
    const found = await check(
      { "/ndk/exec/types.i": "" },
      '\tinclude "exec/types.i"',
      ["/ndk"],
    );
    expect(found.size).toBe(0);
  });

  test("says nothing about a path that does not resolve", async () => {
    const found = await check({}, '\tinclude "missing.i"');
    expect(found.size).toBe(0);
  });

  test("covers INCBIN as well as INCLUDE", async () => {
    const found = await check({ "/p/Data.bin": "" }, '\tincbin "data.bin"');
    expect(found.get("data.bin")).toBe("Data.bin");
  });

  test("leaves . and .. alone", async () => {
    const found = await check(
      { "/w/Shared/Hw.i": "" },
      '\tinclude "../shared/hw.i"',
      [],
      "/w/p/main.s",
    );
    expect(found.get("../shared/hw.i")).toBe("../Shared/Hw.i");
  });

  test("uses the first place that has the file", async () => {
    const found = await check(
      { "/a/Hw.i": "", "/b/HW.I": "" },
      '\tinclude "hw.i"',
      ["/a", "/b"],
    );
    expect(found.get("hw.i")).toBe("Hw.i");
  });

  test("says nothing where the file system cannot list directories", async () => {
    const fs = memoryFs({ "/p/Hw.i": "" }, true);
    delete fs.list;
    const found = await includeCaseOnDisk(
      { path: resolve("/p/main.s"), source: '\tinclude "hw.i"' },
      { includePaths: [], fs },
    );
    expect(found.size).toBe(0);
    expect(dirname(resolve("/p/main.s"))).toBe(resolve("/p"));
  });
});
