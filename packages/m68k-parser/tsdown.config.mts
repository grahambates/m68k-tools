import { defineConfig } from "tsdown";
import { libraryDefaults } from "../../tsdown.base.mts";
export default defineConfig({
  ...libraryDefaults,
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  platform: "neutral",
  sourcemap: true,
  outExtensions: ({ format }) => ({
    js: format === "es" ? ".mjs" : ".cjs",
    dts: format === "es" ? ".d.mts" : ".d.cts",
  }),
});
