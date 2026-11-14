import LabelColonFormatter, {
  type ColonOptions,
  type LabelColonOptions,
} from "../../src/formatter/formatters/LabelColonFormatter";
import { applyEdits, formatContext } from "../helpers";

async function doFormat(
  src: string,
  label?: LabelColonOptions,
  others: Omit<ColonOptions, "label"> = {},
) {
  const formatter = new LabelColonFormatter({ label, ...others });
  const edits = formatter.format(formatContext(src));
  return applyEdits(src, edits);
}

describe("LabelColonFormatter", () => {
  it("leaves colons as-is", async () => {
    const result = await doFormat(`foo: move d0,d1\n.bar add d0,d1`, "any");
    expect(result).toBe("foo: move d0,d1\n.bar add d0,d1");
  });

  it("adds colons to all labels", async () => {
    const result = await doFormat(`foo move d0,d1\n.bar add d0,d1`, "on");
    expect(result).toBe("foo: move d0,d1\n.bar: add d0,d1");
  });

  it("removes colons from all labels", async () => {
    const result = await doFormat(`foo: move d0,d1\n.bar: add d0,d1`, "off");
    expect(result).toBe("foo move d0,d1\n.bar add d0,d1");
  });

  it("always keeps double colons for external labels", async () => {
    const result = await doFormat(`foo:: move d0,d1\n.bar: add d0,d1`, "off");
    expect(result).toBe("foo:: move d0,d1\n.bar add d0,d1");
  });

  it("adds colons to global labels", async () => {
    const result = await doFormat(`foo move d0,d1\n.bar add d0,d1`, {
      global: "on",
    });
    expect(result).toBe("foo: move d0,d1\n.bar add d0,d1");
  });

  it("adds colons to local labels", async () => {
    const result = await doFormat(`foo move d0,d1\n.bar add d0,d1`, {
      local: "on",
    });
    expect(result).toBe("foo move d0,d1\n.bar: add d0,d1");
  });

  it("adds colons to non-inline labels", async () => {
    const result = await doFormat(
      `foo\n move d0,d1\n.bar add d0,d1`,
      "notInline",
    );
    expect(result).toBe("foo:\n move d0,d1\n.bar add d0,d1");
  });

  it("adds colons to inline labels", async () => {
    const result = await doFormat(
      `foo\n move d0,d1\n.bar add d0,d1`,
      "onlyInline",
    );
    expect(result).toBe("foo\n move d0,d1\n.bar: add d0,d1");
  });

  it("adds colon in correct place with multiple macro args", async () => {
    const result = await doFormat(`foo\\1bar\\2`, "on");
    expect(result).toBe("foo\\1bar\\2:");
  });

  // Issue #29: equates and macro names have their own options, so a label
  // style does not reach them.
  const equates = ["A = 1", "B equ 2", "C SET 3", "D equr d0", "E reg d0-d2"];
  const symbols = [...equates, "G fequ.s 1.5", "M macro", " endm"].join("\n");
  const withColons = (src: string) => src.replace(/^(\w+)/gm, "$1:");

  it("leaves equates and macro names to their own options", async () => {
    expect(await doFormat(`${symbols}\nfoo nop`, "on")).toBe(
      `${symbols}\nfoo: nop`,
    );
    expect(await doFormat(withColons(`${symbols}\nfoo nop`), "off")).toBe(
      `${withColons(symbols)}\nfoo nop`,
    );
  });

  it("adds colons to equates", async () => {
    const result = await doFormat(`${equates.join("\n")}\nM macro`, "any", {
      equate: "on",
    });
    expect(result).toBe(`${withColons(equates.join("\n"))}\nM macro`);
  });

  it("removes colons from equates", async () => {
    const src = withColons(equates.join("\n"));
    const result = await doFormat(src, "any", { equate: "off" });
    expect(result).toBe(equates.join("\n"));
  });

  it("adds and removes colons on macro names", async () => {
    expect(
      await doFormat("M macro\n endm\nA = 1", "any", { macro: "on" }),
    ).toBe("M: macro\n endm\nA = 1");
    expect(await doFormat("M: macro\n endm", "any", { macro: "off" })).toBe(
      "M macro\n endm",
    );
  });

  it("does not remove a symbol colon that keeps an indented name a name", async () => {
    const result = await doFormat(" A: equ 1", "any", { equate: "off" });
    expect(result).toBe(" A: equ 1");
  });

  it("keeps double colons on exported equates", async () => {
    const result = await doFormat("A:: equ 1", "any", { equate: "off" });
    expect(result).toBe("A:: equ 1");
  });

  it("treats structure and frame offsets as labels", async () => {
    const src = "A rs.w 1\nB so.l 1\nC fo.b 2";
    expect(await doFormat(src, "on", { equate: "off" })).toBe(withColons(src));
    expect(await doFormat(withColons(src), "off", { equate: "on" })).toBe(src);
  });

  it("treats data directives as labels", async () => {
    const result = await doFormat(`foo dc.w 1\nbar ds.b 4`, "on");
    expect(result).toBe(`foo: dc.w 1\nbar: ds.b 4`);
  });
});
