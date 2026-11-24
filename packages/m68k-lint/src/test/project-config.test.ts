import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findProjectConfig,
  loadProjectConfig,
  shadowedConfigFiles,
} from "../cli/project-config.js";

describe("project config", () => {
  test("rejects the removed performance category", async () => {
    // `performance` never had any rules and was removed in favour of putting
    // substitutions in `optimization`. Erroring beats silently ignoring it.
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-config-perf-"));
    const config = join(root, "m68k-lint.json");
    await writeFile(
      config,
      JSON.stringify({ categories: { performance: false } }),
    );
    await expect(loadProjectConfig(config)).rejects.toThrow(
      /Unknown category 'performance'/,
    );
  });

  test("still accepts the surviving categories", async () => {
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-config-cats-"));
    const config = join(root, "m68k-lint.json");
    await writeFile(
      config,
      JSON.stringify({ categories: { portability: true, style: false } }),
    );
    expect((await loadProjectConfig(config)).categories).toEqual({
      portability: true,
      style: false,
    });
  });

  test("finds config walking upward", async () => {
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-config-"));
    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    const config = join(root, "m68k-lint.json");
    await writeFile(config, JSON.stringify({ platform: "amiga" }));
    expect(await findProjectConfig(nested)).toBe(config);
  });

  test("prefers .m68klintrc.json, and names the file it hides", async () => {
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-config-both-"));
    const dotted = join(root, ".m68klintrc.json");
    const plain = join(root, "m68k-lint.json");
    await writeFile(plain, "{}");
    expect(await findProjectConfig(root)).toBe(plain);
    expect(await shadowedConfigFiles(plain)).toEqual([]);

    await writeFile(dotted, "{}");
    expect(await findProjectConfig(root)).toBe(dotted);
    expect(await shadowedConfigFiles(dotted)).toEqual([plain]);
  });

  test("loads lint and discovery settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-config-load-"));
    const config = join(root, ".m68klintrc.json");
    await writeFile(
      config,
      JSON.stringify({
        processors: ["mc68000"],
        platform: "amiga",
        goal: "speed",
        extensions: [".s", ".i"],
        ignorePatterns: ["generated/**"],
        inlineConfig: false,
        presets: ["style"],
        rules: { "suspicious/nop": "warning" },
      }),
    );
    const loaded = await loadProjectConfig(config);
    expect(loaded.platform).toBe("amiga");
    expect(loaded.goal).toBe("speed");
    expect(loaded.rules?.["suspicious/nop"]).toBe("warning");
    expect(loaded.inlineConfig).toBe(false);
    expect(loaded.presets).toEqual(["style"]);
  });

  test("reads processors by mc name and by number", async () => {
    const root = await mkdtemp(join(tmpdir(), "m68k-lint-config-cpu-"));
    const config = join(root, ".m68klintrc.json");
    await writeFile(
      config,
      JSON.stringify({ processors: ["68020", "mc68030"] }),
    );
    expect((await loadProjectConfig(config)).processors).toEqual([
      "mc68020",
      "mc68030",
    ]);
    await writeFile(config, JSON.stringify({ processors: ["68050"] }));
    await expect(loadProjectConfig(config)).rejects.toThrow(
      /unknown CPU; expected mc68000/,
    );
  });
});

test("validates project annotation modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "m68k-lint-annotate-"));
  const path = join(root, "m68k-lint.json");
  for (const fixAnnotate of ["obfuscated", "all", "none"]) {
    await writeFile(path, JSON.stringify({ fixAnnotate }));
    expect(await loadProjectConfig(path)).toMatchObject({ fixAnnotate });
  }
  for (const fixAnnotate of [true, false, "invalid", null]) {
    await writeFile(path, JSON.stringify({ fixAnnotate }));
    await expect(loadProjectConfig(path)).rejects.toThrow(/fixAnnotate/);
  }
});
