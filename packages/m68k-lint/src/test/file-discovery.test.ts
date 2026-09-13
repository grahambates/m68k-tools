import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverFiles, globToRegExp } from "../cli/file-discovery.js";

describe("CLI file discovery", () => {
  test("discovers default assembly extensions recursively", async () => {
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-discovery-"));
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "a.s"), " nop\n");
    await writeFile(join(root, "sub", "b.asm"), " nop\n");
    await writeFile(join(root, "sub", "c.i"), " nop\n");
    await writeFile(join(root, "sub", "d.txt"), "ignore\n");
    const files = await discoverFiles([root], { cwd: root });
    expect(
      files.map((f) => f.slice(root.length + 1).replace(/\\/g, "/")),
    ).toEqual(["a.s", "sub/b.asm", "sub/c.i"]);
  });

  test("explicit files bypass extension filtering", async () => {
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-explicit-"));
    const file = join(root, "source.custom");
    await writeFile(file, " nop\n");
    expect(await discoverFiles([file], { cwd: root })).toEqual([file]);
  });

  test("supports double-star globs and ignore patterns", async () => {
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-glob-"));
    await mkdir(join(root, "src", "generated"), { recursive: true });
    await writeFile(join(root, "src", "main.s"), " nop\n");
    await writeFile(join(root, "src", "generated", "auto.s"), " nop\n");
    const files = await discoverFiles([join(root, "src", "**", "*.s")], {
      cwd: root,
      ignorePatterns: ["src/generated/**"],
    });
    expect(files).toEqual([join(root, "src", "main.s")]);
  });

  test("glob conversion handles common patterns", () => {
    expect(globToRegExp("src/**/*.asm").test("src/a/b.asm")).toBe(true);
    expect(globToRegExp("src/**/*.asm").test("src/b.asm")).toBe(true);
    expect(globToRegExp("src/*.asm").test("src/a/b.asm")).toBe(false);
  });
});
