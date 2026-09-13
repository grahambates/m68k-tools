import { defineConfig } from "vitest/config";
import shared from "./vitest.package.config.mts";
export default defineConfig({
  test: {
    ...shared.test,
    include: [
      "packages/m68k-lsp-server/test/**/*.test.ts",
      "apps/m68k-lsp/test/**/*.test.ts",
      "packages/m68k-formatter/test/**/*.test.ts",
    ],
  },
});
