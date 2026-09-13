import { defineConfig } from "tsdown";
import { unbundledDefaults } from "../../tsdown.base.mts";

export default defineConfig({
  ...unbundledDefaults,
  format: ["esm", "cjs"],
  outExtensions: ({ format }) => ({
    js: format === "es" ? ".mjs" : ".js",
    dts: format === "es" ? ".d.mts" : ".d.ts",
  }),
});
