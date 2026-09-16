import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectConfig, loadProjectConfig } from "../cli/project-config.js";

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
