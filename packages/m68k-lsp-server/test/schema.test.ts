import { readFileSync } from "fs";
import { join } from "path";
import { defaultConfig } from "../src/config";

const schema = JSON.parse(
  readFileSync(join(__dirname, "../m68krc.schema.json"), "utf8"),
);

describe("m68krc.schema.json", () => {
  it("describes every config setting", () => {
    const keys = Object.keys(schema.properties);
    for (const key of [...Object.keys(defaultConfig), "caseSensitive"]) {
      expect(keys).toContain(key);
    }
  });

  it("describes every vasm setting", () => {
    expect(Object.keys(schema.properties.vasm.properties).sort()).toEqual(
      Object.keys(defaultConfig.vasm).sort(),
    );
  });

  it("describes every default formatter alignment setting", () => {
    const align = Object.keys(schema.$defs.format.properties.align.properties);
    for (const key of Object.keys(defaultConfig.format.align ?? {})) {
      expect(align).toContain(key);
    }
  });

  it("agrees with the defaults", () => {
    expect(schema.properties.processors.default).toEqual(
      defaultConfig.processors,
    );
    expect(schema.properties.vasm.properties.binPath.default).toBe(
      "vasmm68k_mot",
    );
  });
});
