import { defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.package.config.mts";
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        exclude: ["src/test/**"],
        thresholds: { statements: 84, branches: 79, functions: 89, lines: 89 },
      },
    },
  }),
);
