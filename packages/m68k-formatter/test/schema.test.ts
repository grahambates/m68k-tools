import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultOptions, loadConfig } from "../src";

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
