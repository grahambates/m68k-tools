import { defineConfig } from "tsdown";
import { unbundledDefaults } from "../../tsdown.base.mts";

export default defineConfig({ ...unbundledDefaults, format: "esm" });
