import { defineConfig } from "tsdown";
import { libraryDefaults } from "../../tsdown.base.mts";

export default defineConfig({
  ...libraryDefaults,
  format: "esm",
  fixedExtension: false,
  entry: {
    index: "src/index.ts",
    "cli/main": "src/cli/main.ts",
    "cli/project-config": "src/cli/project-config.ts",
    // Not exported; the docs generator formats impact figures with it.
    "cli/format": "src/cli/format.ts",
  },
});
