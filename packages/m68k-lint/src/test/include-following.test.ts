import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  configIncludePaths,
  entryDirectories,
  followIncludes,
  includeCaseOnDisk,
  nodeIncludeFs,
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

describe("following includes in a project of many main sources", () => {
  test("looks for an include named by many files once, not once per file", async () => {
    // Forty main sources each name the same include, which only one directory
    // has. Trying every main source's directory for every file that names it
    // is forty lookups each, and a project of a few thousand files made that
    // the whole cost of indexing it.
    const files: Record<string, string> = { "/p/d39/shared.i": "" };
    const sources = [];
    for (let i = 0; i < 40; i++) {
      const path = `/p/d${i}/main.s`;
      files[path] = '\tinclude "shared.i"';
      sources.push({ path, source: files[path] });
    }
    const base = memoryFs(files);
    let lookups = 0;
    const fs: IncludeFs = {
      ...base,
      find: (dir, name) => {
        lookups++;
        return base.find(dir, name);
      },
    };
    const found = await followIncludes(sources, { includePaths: [], fs });
    expect(paths(found)).toEqual([resolve("/p/d39/shared.i")]);
    expect(lookups).toBeLessThan(200);
  });

  test("still resolves each file's own include when the names differ", async () => {
    const files: Record<string, string> = {};
    const sources = [];
    for (let i = 0; i < 12; i++) {
      files[`/p/d${i}/main.s`] = `\tinclude "u${i}.i"`;
      files[`/p/d${i}/u${i}.i`] = "";
      sources.push({
        path: `/p/d${i}/main.s`,
        source: files[`/p/d${i}/main.s`],
      });
    }
    const found = await followIncludes(sources, {
      includePaths: [],
      fs: memoryFs(files),
    });
    expect(paths(found).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => resolve(`/p/d${i}/u${i}.i`)).sort(),
    );
  });
});

describe("nodeIncludeFs", () => {
  /** What the operating system says, asked the slow way, for comparison. */
  const stat = (dir: string, name: string) => {
    const path = resolve(dir, name);
    try {
      return statSync(path).isFile() ? path : undefined;
    } catch {
      return undefined;
    }
  };

  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "include-fs-"));
    mkdirSync(join(root, "lib", "Exec"), { recursive: true });
    mkdirSync(join(root, "empty"));
    mkdirSync(join(root, "adir.i"));
    writeFileSync(join(root, "hw.i"), "");
    writeFileSync(join(root, "lib", "Exec", "Types.i"), "");
    writeFileSync(join(root, "lib", "a b.i"), "");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("agrees with asking the file system, for what is there and what is not", async () => {
    const fs = nodeIncludeFs();
    const asks: [string, string][] = [
      [root, "hw.i"],
      [root, "HW.I"], // wrong case: whatever this file system says
      [root, "missing.i"],
      [root, "adir.i"], // a directory is not a file
      [root, "lib/Exec/Types.i"],
      [root, "lib/exec/types.i"], // wrong case in a directory and a file
      [root, "LIB/EXEC/TYPES.I"],
      [root, "lib/a b.i"],
      [root, "lib/../hw.i"],
      [join(root, "lib"), "../hw.i"],
      [join(root, "empty"), "hw.i"],
      [join(root, "no-such-dir"), "hw.i"],
      [join(root, "no-such-dir"), "sub/hw.i"],
      [root, ""],
    ];
    for (const [dir, name] of asks)
      expect(await fs.find(dir, name), `${dir} ${name}`).toBe(stat(dir, name));
  });

  test("answers the same lookup the same way each time", async () => {
    const fs = nodeIncludeFs();
    expect(await fs.find(root, "hw.i")).toBe(join(root, "hw.i"));
    expect(await fs.find(root, "hw.i")).toBe(join(root, "hw.i"));
    expect(await fs.find(root, "nope.i")).toBeUndefined();
    expect(await fs.find(root, "nope.i")).toBeUndefined();
  });

  test("finds an open editor's text for a file that is not on disk", async () => {
    const path = join(root, "unsaved.i");
    const fs = nodeIncludeFs(new Map([[path, "X equ 1"]]));
    expect(await fs.find(root, "unsaved.i")).toBe(path);
    expect(await fs.read(path)).toBe("X equ 1");
    // Only for that path.
    expect(await fs.find(root, "other.i")).toBeUndefined();
  });

  test("still lists a directory for the case check", async () => {
    const names = await nodeIncludeFs().list?.(root);
    expect(names).toEqual(expect.arrayContaining(["hw.i", "lib", "empty"]));
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
