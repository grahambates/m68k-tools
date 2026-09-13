import type { UserConfig } from "tsdown";

export const libraryDefaults = {
  platform: "node",
  target: "es2022",
  outDir: "dist",
  dts: true,
  clean: true,
} satisfies UserConfig;

// Preserve src-relative paths for packages that publish individual modules.
export const unbundledDefaults = {
  ...libraryDefaults,
  entry: [
    "src/**/*.ts",
    "!src/**/test/**",
    "!src/**/*.test.ts",
    "!src/**/*.d.ts",
  ],
  root: "src",
  fixedExtension: false,
  unbundle: true,
} satisfies UserConfig;
