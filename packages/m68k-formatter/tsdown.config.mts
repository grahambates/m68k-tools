import { defineConfig } from "tsdown";
import { libraryDefaults } from "../../tsdown.base.mts";
export default defineConfig({
  ...libraryDefaults,
  entry: ["src/index.ts", "src/cli.ts"],
  outDir: "out",
  format: ["esm", "cjs"],
  fixedExtension: false,
  outExtensions: ({ format }) => ({
    js: format === "es" ? ".mjs" : ".js",
    dts: format === "es" ? ".d.mts" : ".d.ts",
  }),
});
