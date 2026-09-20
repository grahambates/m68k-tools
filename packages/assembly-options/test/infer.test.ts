import { editAssemblyConfig, inferSearchDirectories } from "../src/index";

const infer = (names: string[], files: string[], roots: string[] = []) =>
  inferSearchDirectories(names, files, { roots });

describe("inferSearchDirectories", () => {
  it("finds the directory in front of a path's suffix", () => {
    const [found] = infer(["lib/defs.i"], ["/p/lib/defs.i", "/p/src/main.s"]);
    expect(found).toMatchObject({ dir: "/p", names: ["lib/defs.i"] });
  });

  it("calls a directory that holds the project a source root, and another a directory of includes", () => {
    const files = ["/p/lib/defs.i", "/p/vendor/inc/exec/types.i"];
    const found = infer(["lib/defs.i", "exec/types.i"], files, ["/p"]);
    expect(found.find((f) => f.names.includes("lib/defs.i"))?.kind).toBe(
      "sourceRoot",
    );
    expect(found.find((f) => f.names.includes("exec/types.i"))).toMatchObject({
      dir: "/p/vendor/inc",
      kind: "includePath",
    });
  });

  it("takes the directory that resolves most of the names", () => {
    const files = ["/p/a/x/one.i", "/p/a/x/two.i", "/p/b/x/one.i"];
    const found = infer(["x/one.i", "x/two.i"], files);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      dir: "/p/a",
      names: ["x/one.i", "x/two.i"],
    });
  });

  it("does not guess between directories that are equally good", () => {
    expect(infer(["x/one.i"], ["/p/a/x/one.i", "/p/b/x/one.i"])).toEqual([]);
  });

  it("takes a bare name only when one file has it", () => {
    expect(infer(["defs.i"], ["/p/a/defs.i"])[0]?.dir).toBe("/p/a");
    expect(infer(["defs.i"], ["/p/a/defs.i", "/p/b/defs.i"])).toEqual([]);
  });

  it("leaves a name that climbs out of a directory", () => {
    expect(infer(["../lib/defs.i"], ["/p/lib/defs.i"])).toEqual([]);
  });

  it("finds nothing for a name no file has", () => {
    expect(infer(["nope.i"], ["/p/defs.i"])).toEqual([]);
  });
});

describe("editAssemblyConfig", () => {
  it("makes a new config with the include path", () => {
    expect(
      JSON.parse(
        editAssemblyConfig(undefined, { includePath: "/p/inc" }, "/p")!,
      ),
    ).toEqual({ includePaths: ["inc"] });
  });

  it("adds to what is there and leaves the rest", () => {
    const text = JSON.stringify({
      processors: ["mc68020"],
      includePaths: ["a"],
    });
    expect(
      JSON.parse(editAssemblyConfig(text, { includePath: "/p/b" }, "/p")!),
    ).toEqual({ processors: ["mc68020"], includePaths: ["a", "b"] });
  });

  it("does not add a path twice", () => {
    const text = JSON.stringify({ includePaths: ["inc"] });
    expect(
      JSON.parse(editAssemblyConfig(text, { includePath: "/p/inc" }, "/p")!),
    ).toEqual({ includePaths: ["inc"] });
  });

  it("sets the source root, a directory holding the config as a dot", () => {
    expect(
      JSON.parse(editAssemblyConfig("{}", { sourceRoot: "/p" }, "/p")!)
        .sourceRoot,
    ).toBe(".");
    expect(
      JSON.parse(editAssemblyConfig("{}", { sourceRoot: "/p/src" }, "/p")!)
        .sourceRoot,
    ).toBe("src");
  });

  it("keeps a directory outside the config's as it is", () => {
    expect(
      JSON.parse(editAssemblyConfig("{}", { includePath: "/ndk/inc" }, "/p")!)
        .includePaths,
    ).toEqual(["/ndk/inc"]);
  });

  it("does not touch text it cannot read", () => {
    expect(
      editAssemblyConfig("{ not json", { includePath: "/p/x" }, "/p"),
    ).toBeUndefined();
    expect(
      editAssemblyConfig("[]", { includePath: "/p/x" }, "/p"),
    ).toBeUndefined();
  });
});
