import {
  assemblerArgs,
  type Config,
  defaultConfig,
  mergeConfig,
} from "../src/config";

const config = (over: Partial<typeof defaultConfig>) => ({
  ...defaultConfig,
  processors: [],
  includePaths: [],
  ...over,
});

describe("assemblerArgs", () => {
  it("adds include paths and processors from the friendly options", () => {
    const args = assemblerArgs(
      config({ includePaths: ["inc"], processors: ["mc68020"] }),
    );
    expect(args).toContain("-Iinc");
    expect(args).toContain("-m68020");
  });

  it("reads processors by number as well as by mc name", () => {
    const merged = mergeConfig(
      { processors: ["68020", "MC68881"] } as unknown as Partial<Config>,
      defaultConfig,
    );
    expect(merged.processors).toEqual(["mc68020", "mc68881"]);
    expect(assemblerArgs(merged)).toEqual(
      expect.arrayContaining(["-m68020", "-m68881"]),
    );
    expect(mergeConfig({}, merged).processors).toEqual(["mc68020", "mc68881"]);
  });

  it("adds -nocase when case is folded by setting", () => {
    expect(assemblerArgs(config({ caseSensitive: false }))).toContain(
      "-nocase",
    );
  });

  it("adds nothing for case by default", () => {
    expect(assemblerArgs(config({}))).not.toContain("-nocase");
  });

  it("adds -esc when escapes are on by setting, once", () => {
    expect(assemblerArgs(config({ escapeSequences: true }))).toContain("-esc");
    const args = assemblerArgs(
      config({
        escapeSequences: true,
        vasm: { ...defaultConfig.vasm, args: ["-esc"] },
      }),
    );
    expect(args.filter((a) => a === "-esc")).toHaveLength(1);
    expect(assemblerArgs(config({}))).not.toContain("-esc");
  });

  it("does not repeat what the custom arguments already say", () => {
    const args = assemblerArgs(
      config({
        caseSensitive: false,
        includePaths: ["inc"],
        vasm: { ...defaultConfig.vasm, args: ["-nocase", "-Iinc"] },
      }),
    );
    expect(args.filter((a) => a === "-nocase")).toHaveLength(1);
    expect(args.filter((a) => a === "-Iinc")).toHaveLength(1);
  });
});
