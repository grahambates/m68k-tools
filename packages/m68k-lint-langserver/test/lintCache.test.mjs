import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { LintCache } from "../src/lintCache.ts";

describe("LintCache", () => {
  const counting = () => {
    let runs = 0;
    return { compute: async () => ++runs, runs: () => runs };
  };

  it("lints an unchanged document once, however often it is asked", async () => {
    const cache = new LintCache();
    const lint = counting();
    assert.equal(await cache.get("file:///a.s", 1, lint.compute), 1);
    assert.equal(await cache.get("file:///a.s", 1, lint.compute), 1);
    assert.equal(await cache.get("file:///a.s", 1, lint.compute), 1);
    assert.equal(lint.runs(), 1);
  });

  it("lints again for a new version", async () => {
    const cache = new LintCache();
    const lint = counting();
    await cache.get("file:///a.s", 1, lint.compute);
    assert.equal(await cache.get("file:///a.s", 2, lint.compute), 2);
    assert.equal(lint.runs(), 2);
  });

  it("keeps documents apart", async () => {
    const cache = new LintCache();
    const lint = counting();
    await cache.get("file:///a.s", 1, lint.compute);
    await cache.get("file:///b.s", 1, lint.compute);
    assert.equal(lint.runs(), 2);
  });

  it("shares a lint that is still running instead of starting another", async () => {
    const cache = new LintCache();
    let runs = 0;
    let finish;
    const slow = () =>
      new Promise((resolve) => {
        runs++;
        finish = () => resolve("done");
      });
    const first = cache.get("file:///a.s", 1, slow);
    const second = cache.get("file:///a.s", 1, slow);
    finish();
    assert.deepEqual(await Promise.all([first, second]), ["done", "done"]);
    assert.equal(runs, 1);
  });

  it("does not keep a lint that failed", async () => {
    const cache = new LintCache();
    await assert.rejects(
      cache.get("file:///a.s", 1, () => Promise.reject(new Error("boom"))),
      /boom/,
    );
    // Let the rejection handler run before asking again.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await cache.get("file:///a.s", 1, async () => "ok"), "ok");
  });

  it("forgets everything on clear, and one document on delete", async () => {
    const cache = new LintCache();
    const lint = counting();
    await cache.get("file:///a.s", 1, lint.compute);
    await cache.get("file:///b.s", 1, lint.compute);
    cache.delete("file:///a.s");
    await cache.get("file:///a.s", 1, lint.compute);
    await cache.get("file:///b.s", 1, lint.compute);
    assert.equal(lint.runs(), 3);
    cache.clear();
    await cache.get("file:///b.s", 1, lint.compute);
    assert.equal(lint.runs(), 4);
  });
});
