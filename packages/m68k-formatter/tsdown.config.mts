import { defineConfig } from "tsdown";
import { libraryDefaults } from "../../tsdown.base.mts";
export default defineConfig({
  ...libraryDefaults,
  entry: ["src/index.ts", "src/cli.ts"],
  outDir: "out",
  format: "cjs",
  fixedExtension: false,
});
