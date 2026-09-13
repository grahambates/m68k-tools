import LabelColonFormatter, {
  type LabelColonOptions,
} from "../../src/formatter/formatters/LabelColonFormatter";
import { applyEdits, formatContext } from "../helpers";

async function doFormat(src: string, options: LabelColonOptions) {
  const formatter = new LabelColonFormatter(options);
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
});
