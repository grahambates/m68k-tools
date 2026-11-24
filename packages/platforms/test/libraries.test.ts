import { libraryFunction, libraryFunctionSynopsis } from "../src/index";

// Offsets and registers as in the NDK's lvo/*.i and the Autodocs' synopses.
describe("library functions", () => {
  test("finds a function by its offset symbol, in either case", () => {
    const fn = libraryFunction("_LVOOpenLibrary");
    expect(fn).toMatchObject({
      name: "OpenLibrary",
      offset: -552,
      returns: "struct Library *",
      library: { name: "exec.library", base: "SysBase" },
    });
    expect(fn?.args).toEqual([
      { type: "CONST_STRPTR", name: "libName", register: "a1" },
      { type: "ULONG", name: "version", register: "d0" },
    ]);
    expect(fn?.url).toMatch(/node0222\.html$/);
    expect(libraryFunction("_lvoopenlibrary")?.name).toBe("OpenLibrary");
    expect(libraryFunction("LVOForbid")?.offset).toBe(-132);
  });

  test("needs the prefix unless asked for a bare name", () => {
    expect(libraryFunction("OpenLibrary")).toBeUndefined();
    expect(libraryFunction("LoadView", { bare: true })).toMatchObject({
      offset: -222,
      library: { name: "graphics.library", base: "GfxBase" },
    });
    expect(libraryFunction("_LVONoSuchFunction")).toBeUndefined();
  });

  test.each([
    ["_LVOOpen", -30, "dos.library", ["d1", "d2"]],
    ["_LVOLoadSeg", -150, "dos.library", ["d1"]],
    ["_LVOAllocMem", -198, "exec.library", ["d0", "d1"]],
    ["_LVOOwnBlitter", -456, "graphics.library", []],
    ["_LVOOpenWindow", -204, "intuition.library", ["a0"]],
    // Supervisor takes its function in A5, not the D7 the inline call uses.
    ["_LVOSupervisor", -30, "exec.library", ["a5"]],
    // A double goes in a pair of registers.
    ["_LVOIEEEDPCmp", -42, "mathieeedoubbas.library", ["d0/d1", "d2/d3"]],
  ])("%s is %i in %s", (symbol, offset, library, registers) => {
    const fn = libraryFunction(symbol)!;
    expect(fn.offset).toBe(offset);
    expect(fn.library.name).toBe(library);
    expect(fn.args?.map((arg) => arg.register)).toEqual(registers);
  });

  test("links each function to its own library's Autodoc page", () => {
    // AbortIO is in exec and documented for timer.device too.
    expect(libraryFunction("_LVOAbortIO")?.url).toMatch(/node01D7\.html$/);
    // A tag list form is documented with the function it calls.
    expect(libraryFunction("_LVOOpenWindowTagList")?.url).toMatch(
      /node03D6\.html$/,
    );
  });

  test("writes a prototype with registers", () => {
    expect(libraryFunctionSynopsis(libraryFunction("_LVOOpenLibrary")!)).toBe(
      "struct Library *OpenLibrary(CONST_STRPTR libName /* a1 */, ULONG version /* d0 */)",
    );
    expect(libraryFunctionSynopsis(libraryFunction("_LVOForbid")!)).toBe(
      "void Forbid()",
    );
  });
});
