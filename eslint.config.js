const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier");
const globals = require("globals");
const react = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const importPlugin = require("eslint-plugin-import");
module.exports = tseslint
  .config(
    {
      ignores: [
        "**/node_modules/**",
        "**/out/**",
        "**/dist/**",
        "**/.tsbuild/**",
        "**/wasm/**",
        "**/coverage/**",
        "**/.vscode-test/**",
        ".staging/**",
        ".husky/**",
        "**/.husky/**",
        "packages/m68k-lint/sources/**",
        "packages/m68k-lint/notes/**",
        "apps/m68k-lsp/syntaxes/**",
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: { globals: globals.node },
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrors: "none",
          },
        ],
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        eqeqeq: ["error", "always", { null: "ignore" }],
        "no-else-return": "error",
        "object-shorthand": ["error", "properties"],
        "prefer-const": "error",
        "no-var": "error",
      },
    },
    {
      files: ["**/*.{js,cjs}"],
      rules: { "@typescript-eslint/no-require-imports": "off" },
    },
    {
      files: [
        "**/test/**/*.ts",
        "**/src/test/**/*.ts",
        "**/*.test.{ts,tsx}",
        "**/setupTests.ts",
      ],
      languageOptions: { globals: globals.vitest },
    },
    {
      files: ["apps/68kcounter-vscode/src/test/**/*.ts"],
      languageOptions: { globals: globals.mocha },
    },
    // The linter already uses checks that require its TypeScript project.
    {
      files: ["packages/m68k-lint/src/**/*.ts"],
      extends: [tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: __dirname },
      },
    },
    {
      files: ["packages/m68k-lint/src/**/*.ts"],
      ignores: [
        "packages/m68k-lint/src/cli/**",
        "packages/m68k-lint/src/test/**",
      ],
      rules: { "no-console": "error" },
    },
    {
      files: ["packages/m68k-lint/src/test/**/*.ts"],
      rules: {
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
      },
    },
    {
      files: ["apps/68kcounter-web/**/*.{ts,tsx,js,mjs}"],
      extends: [
        react.configs.flat.recommended,
        react.configs.flat["jsx-runtime"],
        importPlugin.flatConfigs.recommended,
        importPlugin.flatConfigs.typescript,
        reactHooks.configs.flat["recommended-latest"],
      ],
      languageOptions: { globals: globals.browser },
      settings: {
        react: { version: "detect" },
        "import/resolver": {
          typescript: { project: "apps/68kcounter-web/tsconfig.json" },
        },
      },
      rules: {
        "react/prop-types": "off",
        "import/no-named-as-default-member": "off",
      },
    },
    {
      files: ["apps/68kcounter-web/src/**/*.{ts,tsx}"],
      rules: { "import/no-default-export": "error" },
    },
    prettier,
  )
  .map((config) => ({ ...config, basePath: __dirname }));
