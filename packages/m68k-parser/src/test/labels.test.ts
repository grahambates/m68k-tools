import { parseFile } from "../file-parser.js";
import {
  analyzeLocalLabelScopes,
  bareLocalName,
  isLocalLabelName,
  labelKind,
  symbolKey,
} from "../labels.js";

const scopes = (source: string) => analyzeLocalLabelScopes(parseFile(source));

describe("local label names", () => {
  it("are spelled with a leading dot or a trailing dollar", () => {
    expect(isLocalLabelName(".loop")).toBe(true);
    expect(isLocalLabelName("loop$")).toBe(true);
    expect(isLocalLabelName("loop")).toBe(false);
    expect(isLocalLabelName("a.b")).toBe(false);
  });

  it("lose the dot and nothing else", () => {
    expect(bareLocalName(".loop")).toBe("loop");
    expect(bareLocalName("loop$")).toBe("loop$");
  });
});

describe("labelKind", () => {
  const kinds = (source: string) =>
    parseFile(source).lines.map((line) => labelKind(line));

  it("is position for labels that mark a place in the program", () => {
    expect(
      kinds("foo:\nbar nop\n.baz dc.w 1\nqux ds.b 4\nsec section x"),
    ).toEqual(["position", "position", "position", "position", "position"]);
  });

  it("is offset for structure and frame offsets", () => {
    expect(kinds("A rs.w 1\nB SO.L 1\nC fo.b 2")).toEqual([
      "offset",
      "offset",
      "offset",
    ]);
  });

  it("is equate for names given a value", () => {
    expect(
      kinds(
        "A = 1\nB EQU 2\nC set 3\nD equr d0\nE reg d0-d2\nF fequ.s 1.5\nG freg fp0",
      ),
    ).toEqual(Array(7).fill("equate"));
  });

  it("is macro for a macro name", () => {
    expect(kinds("M macro\n endm")[0]).toBe("macro");
  });

  it("is undefined for a line without a label", () => {
    expect(kinds(" nop\n; comment\n")).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("analyzeLocalLabelScopes", () => {
  it("gives each routine its own .loop", () => {
    const source = "a:\n.loop: nop\nb:\n.loop: nop\n";
    const s = scopes(source);
    expect(s.keyOf(1, ".loop")).not.toBe(s.keyOf(3, ".loop"));
    // Case matters unless it is folded.
    expect(s.keyOf(1, ".loop")).not.toBe(s.keyOf(1, ".LOOP"));
    const folded = analyzeLocalLabelScopes(parseFile(source), {
      caseSensitive: false,
    });
    expect(folded.keyOf(1, ".loop")).toBe(folded.keyOf(1, ".LOOP"));
  });

  it("names the scope a line is in", () => {
    const s = scopes("start: nop\n nop\nNext: nop\n");
    expect(s.scopeOf(1)).toBe("start");
    expect(s.scopeOf(2)).toBe("Next");
  });

  it("treats both local spellings as one name", () => {
    const s = scopes("a:\n.x: nop\n");
    expect(s.keyOf(1, ".x")).toBe(s.keyOf(1, "x"));
  });

  it("has no scope before the first label", () => {
    expect(scopes(" nop\n").scopeOf(0)).toBeUndefined();
  });

  it("is not moved by a label that only defines a symbol", () => {
    const s = scopes("a:\nCOUNT equ 4\n.x: nop\n");
    expect(s.scopeOf(2)).toBe("a");
  });

  // Checked against vasm: a branch from `a` to `.x` resolves across each of
  // these, whereas a `dc.w` label in the same place starts a new routine.
  it.each(["rs.w 1", "so.w 1", "fo.w 1"])(
    "is not moved by a structure offset label (%s)",
    (directive) => {
      const s = scopes(`a:\nFIELD ${directive}\n.x: nop\n`);
      expect(s.scopeOf(2)).toBe("a");
    },
  );

  it("is not moved by a label inside a macro body", () => {
    const s = scopes("a:\nM: macro\ninner: nop\nendm\n.x: nop\n");
    expect(s.scopeOf(4)).toBe("a");
  });

  it("is not moved by a label inside conditional assembly", () => {
    const s = scopes("a:\n if 1\nb: nop\n endc\n.x: nop\n");
    expect(s.scopeOf(4)).toBe("a");
  });

  it("is moved by a label inside a repeat, which is assembled", () => {
    const s = scopes("a:\n rept 2\nb: nop\n endr\n.x: nop\n");
    expect(s.scopeOf(4)).toBe("b");
  });
});

describe("symbolKey", () => {
  it("keeps case by default, as an assembler does", () => {
    expect(symbolKey("Foo")).toBe("Foo");
    expect(symbolKey("Foo")).not.toBe(symbolKey("foo"));
  });

  it("folds case when asked to, so both spellings are one name", () => {
    expect(symbolKey("Foo", false)).toBe(symbolKey("foo", false));
    expect(symbolKey("FOO", false)).toBe("foo");
  });
});

describe("local label scopes and case", () => {
  const source = "Start:\n.loop: nop\nstart:\n.loop: nop\n";

  it("keep Start and start apart by default", () => {
    const s = analyzeLocalLabelScopes(parseFile(source));
    expect(s.keyOf(1, ".loop")).not.toBe(s.keyOf(3, ".loop"));
  });

  it("treat them as one routine when case is folded", () => {
    const s = analyzeLocalLabelScopes(parseFile(source), {
      caseSensitive: false,
    });
    expect(s.keyOf(1, ".loop")).toBe(s.keyOf(3, ".loop"));
  });

  it("tell .Loop from .loop by default, and not when folded", () => {
    const file = parseFile("a:\n.Loop: nop\n.loop: nop\n");
    const sensitive = analyzeLocalLabelScopes(file);
    expect(sensitive.keyOf(1, ".Loop")).not.toBe(sensitive.keyOf(2, ".loop"));
    const folded = analyzeLocalLabelScopes(file, { caseSensitive: false });
    expect(folded.keyOf(1, ".Loop")).toBe(folded.keyOf(2, ".loop"));
  });
});
