import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultOptions,
  findConfig,
  findConfigs,
  loadConfig,
  loadConfigs,
} from "../src";

const schema = JSON.parse(
  readFileSync(join(__dirname, "../m68k-format.schema.json"), "utf8"),
);

describe("m68k-format.schema.json", () => {
  it("describes every default option", () => {
    const keys = Object.keys(schema.properties);
    for (const key of Object.keys(defaultOptions)) expect(keys).toContain(key);
    const align = Object.keys(schema.properties.align.properties);
    for (const key of Object.keys(defaultOptions.align ?? {}))
      expect(align).toContain(key);
  });

  it("is accepted by the loader along with the file that names it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m68k-format-"));
    try {
      const path = join(dir, ".m68k-format.json");
      await writeFile(
        path,
        JSON.stringify({ $schema: schema.$id, case: "upper" }),
      );
      expect(await loadConfig(path)).toEqual({ case: "upper" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the shared .m68krc.json", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-format-rc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const write = (name: string, value: unknown) =>
    writeFile(join(dir, name), JSON.stringify(value));

  it("supplies the options in its format section", async () => {
    await write(".m68krc.json", {
      processors: ["mc68020"],
      format: { case: "upper" },
    });
    const found = await findConfig(dir);
    expect(found).toBe(join(dir, ".m68krc.json"));
    expect(await loadConfig(found!)).toEqual({ case: "upper" });
  });

  it("is passed over when it has no format section", async () => {
    await write(".m68krc.json", { processors: ["mc68020"] });
    await mkdir(join(dir, "sub"));
    await write(".m68k-format.json", { case: "lower" });
    expect(await findConfig(join(dir, "sub"))).toBe(
      join(dir, ".m68k-format.json"),
    );
  });

  it("gives way to the formatter's own file in the same directory", async () => {
    await write(".m68krc.json", { format: { case: "upper" } });
    await write(".m68k-format.json", { case: "lower" });
    expect(await findConfig(dir)).toBe(join(dir, ".m68k-format.json"));
  });

  it("is checked like the formatter's own file", async () => {
    await write(".m68krc.json", { format: { case: "sideways" } });
    await expect(loadConfig(join(dir, ".m68krc.json"))).rejects.toThrow(
      "Invalid formatter configuration",
    );
  });

  it("is merged under the formatter's own file, which is the nearer", async () => {
    await write(".m68krc.json", {
      format: { case: "upper", align: { mnemonic: 10, operands: 20 } },
    });
    await mkdir(join(dir, "sub"));
    await writeFile(
      join(dir, "sub", ".m68k-format.json"),
      JSON.stringify({ align: { mnemonic: 12 } }),
    );
    const paths = await findConfigs(join(dir, "sub"));
    expect(paths).toEqual([
      join(dir, ".m68krc.json"),
      join(dir, "sub", ".m68k-format.json"),
    ]);
    expect(await loadConfigs(paths)).toEqual({
      case: "upper",
      align: { mnemonic: 12, operands: 20 },
    });
  });

  it("goes on top when it is the nearer", async () => {
    await write(".m68k-format.json", { case: "lower", quotes: "single" });
    await mkdir(join(dir, "sub"));
    await writeFile(
      join(dir, "sub", ".m68krc.json"),
      JSON.stringify({ format: { case: "upper" } }),
    );
    expect(
      await loadConfigs(await findConfigs(join(dir, "sub"))),
    ).toMatchObject({
      case: "upper",
      quotes: "single",
    });
  });
});
