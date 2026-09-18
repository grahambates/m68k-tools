import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverAssemblyFiles,
  isAssemblySource,
  walkFiles,
} from "../src/index.js";

describe("isAssemblySource", () => {
  test("matches the default extensions case-insensitively", () => {
    expect(isAssemblySource("main.s")).toBe(true);
    expect(isAssemblySource("MAIN.S")).toBe(true);
    expect(isAssemblySource("hw.i")).toBe(true);
    expect(isAssemblySource("notes.txt")).toBe(false);
  });

  test("accepts a caller-supplied extension list", () => {
    expect(isAssemblySource("hw.inc", [".inc"])).toBe(true);
    expect(isAssemblySource("hw.i", [".inc"])).toBe(false);
  });
});

describe("discoverAssemblyFiles", () => {
  let dir: string;

  const write = async (name: string, text = "") => {
    const path = join(dir, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text, "utf8");
    return path;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-workspace-files-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("finds assembly files and ignores others", async () => {
    const main = await write("main.s");
    await write("readme.md");

    expect(await discoverAssemblyFiles(dir)).toEqual([main]);
  });

  test("skips the default excluded directories, without enumerating them", async () => {
    const source = await write("src/main.s");
    for (const directory of [
      "node_modules",
      ".git",
      "build",
      "out",
      "dist",
      "target",
    ]) {
      await write(`${directory}/nested/ignored.s`);
    }

    const readdir = vi.spyOn(fsp, "readdir");
    const found = await discoverAssemblyFiles(dir);
    expect(found).toEqual([source]);
    expect(readdir.mock.calls.map(([path]) => String(path)).sort()).toEqual(
      [dir, join(dir, "src")].sort(),
    );
  });

  test("keeps traversing a folder when only particular files are excluded", async () => {
    const kept = await write("src/kept.i");
    await write("src/generated.s");
    const nested = await write("sources.s/nested/kept.i");

    const found = await discoverAssemblyFiles(dir, { exclude: ["**/*.s"] });
    expect(found.sort()).toEqual([kept, nested].sort());
  });

  test("honours a caller-supplied extension list", async () => {
    const header = await write("hw.inc");
    await write("main.s");

    const found = await discoverAssemblyFiles(dir, { extensions: [".inc"] });
    expect(found).toEqual([header]);
  });

  test("stops once the file limit is reached", async () => {
    await write("a.s");
    await write("b.s");
    await write("c.s");

    const found = await discoverAssemblyFiles(dir, { limit: 2 });
    expect(found).toHaveLength(2);
  });

  test("contributes nothing for a directory that does not exist", async () => {
    expect(await discoverAssemblyFiles(join(dir, "missing"))).toEqual([]);
  });
});

describe("walkFiles", () => {
  let dir: string;

  const write = async (name: string) => {
    const path = join(dir, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "", "utf8");
    return path;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-workspace-files-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("applies no default policy: an unfiltered include sees everything", async () => {
    const main = await write("main.s");
    const generated = await write("build/generated.s");

    const found = await walkFiles(dir, {
      include: (path) => path.endsWith(".s"),
    });
    expect(found.sort()).toEqual([main, generated].sort());
  });
});
