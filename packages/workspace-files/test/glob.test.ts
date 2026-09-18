import { defaultExclude, isExcluded, matchesGlob } from "../src/glob.js";

describe("isExcluded", () => {
  test("matches a file against a glob pattern", () => {
    expect(isExcluded("/proj/build/main.s", ["**/build/**"])).toBe(true);
    expect(isExcluded("/proj/src/main.s", ["**/build/**"])).toBe(false);
  });

  test("prunes a directory only when a pattern covers its whole subtree", () => {
    expect(isExcluded("/proj/build", ["**/build/**"], true)).toBe(true);
    // A file-shaped pattern can match a directory's own name without proving
    // every descendant is excluded, so it must not prune.
    expect(isExcluded("/proj/build", ["**/build"], true)).toBe(false);
  });

  test("a negated pattern never prunes a directory", () => {
    expect(isExcluded("/proj/build", ["!**/build/**"], true)).toBe(false);
  });

  test("the default exclusions cover the usual build and vendor directories", () => {
    for (const dir of [
      "node_modules",
      ".git",
      "build",
      "out",
      "dist",
      "target",
    ]) {
      expect(isExcluded(`/proj/${dir}`, defaultExclude, true)).toBe(true);
    }
    expect(isExcluded("/proj/src", defaultExclude, true)).toBe(false);
  });
});

describe("matchesGlob", () => {
  test("matches dotfiles and respects path separators", () => {
    expect(matchesGlob("src/a/b.asm", "src/**/*.asm")).toBe(true);
    expect(matchesGlob("src/b.asm", "src/**/*.asm")).toBe(true);
    expect(matchesGlob("src/a/b.asm", "src/*.asm")).toBe(false);
    expect(matchesGlob("src/.hidden.s", "src/*.s")).toBe(true);
  });
});
