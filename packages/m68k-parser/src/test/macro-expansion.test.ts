import { parseFile } from "../file-parser.js";
import { parseLine } from "../line-parser.js";
import {
  collectMacroDefinitions,
  expandMacro,
  macroInvocation,
  substituteMacroParameters,
  type MacroDefinition,
} from "../macro-expansion.js";

const definitions = (source: string) =>
  collectMacroDefinitions(parseFile(source), source.split("\n"));

const invocation = (...args: string[]) => ({
  arguments: args.map((text) => ({ text })),
  carg: 1,
});

describe("collectMacroDefinitions", () => {
  it("names a macro by its label", () => {
    const [definition] = definitions("Foo macro\n move d0,d1\n endm\n");
    expect(definition).toMatchObject({
      name: "Foo",
      body: [" move d0,d1"],
      start: 0,
      end: 2,
    });
  });

  it("names a macro by its operand", () => {
    const [definition] = definitions("  macro Foo\n move d0,d1\n endm\n");
    expect(definition).toMatchObject({ name: "Foo", body: [" move d0,d1"] });
  });

  it("reports every definition, so duplicates can be seen", () => {
    const found = definitions(
      "A macro\n nop\n endm\nA macro\n rts\n endm\nB macro\n nop\n endm\n",
    );
    expect(found.map((d) => d.name)).toEqual(["A", "A", "B"]);
  });

  it("skips a definition that is never closed", () => {
    expect(definitions("A macro\n nop\n")).toEqual([]);
  });
});

describe("substituteMacroParameters", () => {
  it("substitutes numbered and lettered arguments", () => {
    const args = Array.from({ length: 10 }, (_, i) => `x${i + 1}`);
    expect(
      substituteMacroParameters("\\1 \\9 \\a", invocation(...args)).text,
    ).toBe("x1 x9 x10");
  });

  it("builds a name out of an argument", () => {
    expect(
      substituteMacroParameters("move.l d\\1,a\\2", invocation("3", "4")).text,
    ).toBe("move.l d3,a4");
  });

  it("uses the call's size for \\0", () => {
    const call = { ...invocation("d0"), qualifier: { text: "w" } };
    expect(substituteMacroParameters("move.\\0 \\1,d1", call).text).toBe(
      "move.w d0,d1",
    );
  });

  it("gives NARG, \\# and \\?n", () => {
    expect(
      substituteMacroParameters("NARG \\# \\?2", invocation("a", "hello")).text,
    ).toBe("2 2 5");
  });

  it("moves CARG with \\+ and \\-", () => {
    const call = invocation("a", "b", "c");
    expect(substituteMacroParameters("\\+ \\+ CARG \\- \\.", call).text).toBe(
      "a b 3 c b",
    );
  });

  it("substitutes \\@ when given a value and leaves it otherwise", () => {
    expect(
      substituteMacroParameters(".l\\@", { ...invocation(), unique: "7" }).text,
    ).toBe(".l7");
    expect(substituteMacroParameters(".l\\@", invocation()).text).toBe(".l\\@");
  });

  it("substitutes nothing for an argument the call did not supply", () => {
    expect(
      substituteMacroParameters("move.l \\1,\\2", invocation("d0")).text,
    ).toBe("move.l d0,");
  });

  it("leaves an unsupplied letter alone, since it may be an escape", () => {
    expect(
      substituteMacroParameters('dc.b "hi\\n",\\1', invocation("d0")).text,
    ).toBe('dc.b "hi\\n",d0');
  });

  it("reads \\10 as \\1 followed by a zero", () => {
    expect(substituteMacroParameters("\\10", invocation("a", "b")).text).toBe(
      "a0",
    );
  });

  it("leaves what it does not recognise", () => {
    expect(
      substituteMacroParameters("move \\1,\\!", invocation("d0")).text,
    ).toBe("move d0,\\!");
  });

  it("records where substituted text came from", () => {
    const call = {
      arguments: [{ text: "d0", origin: "call-1", literal: true }],
      carg: 1,
    };
    const { text, spans } = substituteMacroParameters("move \\1,d1", call);
    expect(text).toBe("move d0,d1");
    expect(spans).toEqual([
      { start: 5, end: 7, origin: "call-1", literal: true },
    ]);
  });
});

describe("macroInvocation", () => {
  it("takes argument text by position, so brackets stay whole", () => {
    const text = " Foo (a0,d1.w),#'a,b'";
    const line = parseLine(text).value;
    const call = macroInvocation(line, text);
    expect(call.arguments.map((a) => a.text)).toEqual(["(a0,d1.w)", "#'a,b'"]);
  });

  it("carries the size qualifier", () => {
    const text = " Foo.w d0";
    const call = macroInvocation(parseLine(text).value, text);
    expect(call.qualifier?.text).toBe("w");
  });
});

describe("expandMacro", () => {
  const lookup = (source: string) => {
    const found = new Map(
      definitions(source).map((d) => [d.name.toLowerCase(), d]),
    );
    return (name: string): MacroDefinition | undefined =>
      found.get(name.toLowerCase());
  };

  it("parses each expanded line", () => {
    const resolve = lookup("Clr macro\n moveq #0,\\1\n endm\n");
    const { lines, incomplete } = expandMacro(
      resolve("Clr")!,
      invocation("d3"),
      { resolve },
    );
    expect(incomplete).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0].line.mnemonic).toMatchObject({ instruction: "moveq" });
    expect(lines[0].line.operands?.[1]).toMatchObject({
      type: "data-register",
      register: "d3",
    });
  });

  it("follows a call to another macro", () => {
    const resolve = lookup(
      "Inner macro\n move.l \\1,d0\n endm\nOuter macro\n Inner \\1\n endm\n",
    );
    const { lines } = expandMacro(resolve("Outer")!, invocation("a1"), {
      resolve,
    });
    expect(lines.map((l) => [l.depth, l.expandedCall])).toEqual([
      [0, true],
      [1, false],
    ]);
    expect(lines[1].text).toBe(" move.l a1,d0");
  });

  it("traces an argument through nested calls to where it was written", () => {
    const resolve = lookup(
      "Inner macro\n move.l \\1,d0\n endm\nOuter macro\n Inner \\1\n endm\n",
    );
    const { lines } = expandMacro(
      resolve("Outer")!,
      { arguments: [{ text: "a1", origin: "call", literal: true }], carg: 1 },
      { resolve },
    );
    expect(lines[1].spans).toEqual([
      { start: 8, end: 10, origin: "call", literal: true },
    ]);
  });

  it("gives each call its own \\@", () => {
    const resolve = lookup(
      "Inner macro\n .l\\@: nop\n endm\nOuter macro\n Inner\n Inner\n endm\n",
    );
    let next = 0;
    const { lines } = expandMacro(resolve("Outer")!, invocation(), {
      resolve,
      unique: () => String(next++),
    });
    expect(lines.filter((l) => !l.expandedCall).map((l) => l.text)).toEqual([
      " .l1: nop",
      " .l2: nop",
    ]);
  });

  it("stops a macro that calls itself", () => {
    const resolve = lookup("Loop macro\n nop\n Loop\n endm\n");
    const { lines, incomplete } = expandMacro(resolve("Loop")!, invocation(), {
      resolve,
    });
    expect(incomplete).toBe(true);
    expect(lines.length).toBeLessThan(5);
  });

  it("stops at the depth limit", () => {
    const resolve = lookup(
      "A macro\n B\n endm\nB macro\n C\n endm\nC macro\n nop\n endm\n",
    );
    const { incomplete } = expandMacro(resolve("A")!, invocation(), {
      resolve,
      maxDepth: 2,
    });
    expect(incomplete).toBe(true);
  });

  it("leaves a call it cannot resolve as a plain line", () => {
    const resolve = lookup("Outer macro\n Missing \\1\n endm\n");
    const { lines, incomplete } = expandMacro(
      resolve("Outer")!,
      invocation("d0"),
      { resolve },
    );
    expect(incomplete).toBe(false);
    expect(lines[0].expandedCall).toBe(false);
    expect(lines[0].line.mnemonic?.type).toBe("macro");
  });
});
