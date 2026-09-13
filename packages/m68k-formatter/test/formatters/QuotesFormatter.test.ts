import QuotesFormatter, {
  type QuotesOptions,
} from "../../src/formatter/formatters/QuotesFormatter";
import { applyEdits, formatContext } from "../helpers";

async function doFormat(src: string, options: QuotesOptions) {
  const formatter = new QuotesFormatter(options);
  const edits = formatter.format(formatContext(src));
  return applyEdits(src, edits);
}

describe("QuotesFormatter", () => {
  it("converts to single", async () => {
    const result = await doFormat(` dc.b "foo bar baz"`, "single");
    expect(result).toBe(" dc.b 'foo bar baz'");
  });

  it("converts to double", async () => {
    const result = await doFormat(` dc.b 'foo bar baz'`, "double");
    expect(result).toBe(` dc.b "foo bar baz"`);
  });

  it("leaves as-is", async () => {
    const result = await doFormat(` dc.b 'foo bar baz'`, "any");
    expect(result).toBe(` dc.b 'foo bar baz'`);
  });
});
