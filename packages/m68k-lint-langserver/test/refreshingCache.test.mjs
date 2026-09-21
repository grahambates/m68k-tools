import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { RefreshingCache } from "../src/refreshingCache.ts";

/** A build the test finishes by hand, so the order of events is its own. */
function pending() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** Lets promise callbacks run; timers are mocked, so this does not wait. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("RefreshingCache", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  /** A cache whose builds are tracked, and which counts how often it says it refreshed. */
  function tracked(quietMs = 2000) {
    const state = { builds: 0, refreshed: 0, next: undefined };
    const cache = new RefreshingCache({
      quietMs,
      onRefreshed: () => state.refreshed++,
    });
    /** A builder for the next value; each call starts a build the test finishes. */
    const builder = () => () => {
      state.builds++;
      state.next = pending();
      return state.next.promise;
    };
    return { cache, state, builder };
  }

  it("builds a value once and serves it", async () => {
    const { cache, state, builder } = tracked();
    const first = cache.get("k", builder());
    state.next.resolve("v0");
    assert.equal(await first, "v0");
    assert.equal(await cache.get("k", builder()), "v0");
    assert.equal(state.builds, 1);
  });

  it("does not rebuild until things have been quiet, and serves the old value meanwhile", async () => {
    const { cache, state, builder } = tracked(2000);
    const first = cache.get("k", builder());
    state.next.resolve("old");
    await first;

    cache.invalidate();
    mock.timers.tick(1999);
    assert.equal(state.builds, 1, "started before it was quiet");
    // Served at once, however long the rebuild takes.
    assert.equal(await cache.get("k", builder()), "old");
    mock.timers.tick(1);
    assert.equal(state.builds, 2);
    assert.equal(await cache.get("k", builder()), "old");

    state.next.resolve("new");
    await settle();
    assert.equal(state.refreshed, 1);
    assert.equal(await cache.get("k", () => assert.fail("built again")), "new");
  });

  it("invalidations that keep arriving are one rebuild, after the last", async () => {
    const { cache, state, builder } = tracked(2000);
    const first = cache.get("k", builder());
    state.next.resolve("v0");
    await first;

    // Five saves a second apart.
    for (let i = 0; i < 5; i++) {
      cache.invalidate();
      mock.timers.tick(1000);
    }
    assert.equal(state.builds, 1, "rebuilt while saves were still arriving");
    mock.timers.tick(1000); // two seconds since the last
    assert.equal(state.builds, 2);
    state.next.resolve("v1");
    await settle();
    assert.equal(state.refreshed, 1);
    mock.timers.tick(10000);
    assert.equal(
      state.builds,
      2,
      "rebuilt again with nothing new to build for",
    );
  });

  it("does not interrupt a rebuild, and follows it with one more if it was invalidated meanwhile", async () => {
    const { cache, state, builder } = tracked(2000);
    const first = cache.get("k", builder());
    state.next.resolve("v0");
    await first;

    cache.invalidate();
    mock.timers.tick(2000); // rebuild 1 starts
    const rebuild1 = state.next;
    // Saved again while it runs, and it goes quiet before it finishes.
    cache.invalidate();
    mock.timers.tick(2000);
    assert.equal(state.builds, 2, "started a second while one was running");

    rebuild1.resolve("v1");
    await settle();
    // The follow-up starts straight away: the quiet period is already over.
    assert.equal(state.builds, 3);
    // v1 is newer than v0, so it is served, but it is not up to date, so nobody is told.
    assert.equal(await cache.get("k", builder()), "v1");
    assert.equal(state.refreshed, 0);

    state.next.resolve("v2");
    await settle();
    assert.equal(state.refreshed, 1, "told once, when it caught up");
    assert.equal(await cache.get("k", () => assert.fail("built again")), "v2");
  });

  it("waits for quiet before the follow-up if it is still being invalidated", async () => {
    const { cache, state, builder } = tracked(2000);
    const first = cache.get("k", builder());
    state.next.resolve("v0");
    await first;

    cache.invalidate();
    mock.timers.tick(2000);
    const rebuild1 = state.next;
    cache.invalidate(); // still busy: the timer for this one is pending
    mock.timers.tick(500);
    rebuild1.resolve("v1");
    await settle();
    assert.equal(state.builds, 2, "started the follow-up before it was quiet");
    mock.timers.tick(1500);
    assert.equal(state.builds, 3);
  });

  it("uses the latest builder for a rebuild, so it sees the latest state", async () => {
    const cache = new RefreshingCache({ quietMs: 10 });
    const seen = [];
    const first = cache.get("k", async () => (seen.push("first"), "v0"));
    await first;
    cache.get("k", async () => (seen.push("latest"), "v1"));
    cache.invalidate();
    mock.timers.tick(10);
    await settle();
    assert.deepEqual(seen, ["first", "latest"]);
  });

  it("serves nothing after clear, and drops a rebuild that was in flight", async () => {
    const { cache, state, builder } = tracked(10);
    const first = cache.get("k", builder());
    state.next.resolve("old");
    await first;
    cache.invalidate();
    mock.timers.tick(10);
    const rebuild = state.next;
    cache.clear();

    const fresh = cache.get("k", builder());
    state.next.resolve("fresh");
    assert.equal(await fresh, "fresh");
    rebuild.resolve("from the old tree");
    await settle();
    assert.equal(state.refreshed, 0);
    assert.equal(
      await cache.get("k", () => assert.fail("built again")),
      "fresh",
    );
  });

  it("does not rebuild after clear if the timer was still waiting", async () => {
    const { cache, state, builder } = tracked(2000);
    const first = cache.get("k", builder());
    state.next.resolve("v0");
    await first;
    cache.invalidate();
    cache.clear();
    mock.timers.tick(5000);
    assert.equal(state.builds, 1);
  });

  it("keeps the old value if the rebuild fails, and tries again at the next invalidation", async () => {
    const { cache, state, builder } = tracked(10);
    const first = cache.get("k", builder());
    state.next.resolve("old");
    await first;

    cache.invalidate();
    mock.timers.tick(10);
    state.next.reject(new Error("boom"));
    await settle();
    assert.equal(state.refreshed, 0);
    assert.equal(await cache.get("k", builder()), "old");

    cache.invalidate();
    mock.timers.tick(10);
    assert.equal(state.builds, 3);
    state.next.resolve("new");
    await settle();
    assert.equal(state.refreshed, 1);
  });

  it("does not keep a first build that failed", async () => {
    const { cache, state, builder } = tracked();
    const first = cache.get("k", builder());
    state.next.reject(new Error("boom"));
    await assert.rejects(first);
    await settle();
    assert.equal(cache.has("k"), false);
    const again = cache.get("k", builder());
    state.next.resolve("ok");
    assert.equal(await again, "ok");
  });

  it("builds at once with set, for a rebuild the caller waits for", async () => {
    const { cache, state, builder } = tracked();
    const first = cache.get("k", builder());
    state.next.resolve("without references");
    await first;
    const second = cache.set("k", builder());
    state.next.resolve("with references");
    assert.equal(await second, "with references");
    assert.equal(
      await cache.get("k", () => assert.fail("built again")),
      "with references",
    );
  });

  it("has nothing stale to serve for a key that was never built", async () => {
    const { cache, state, builder } = tracked();
    const a = cache.get("a", builder());
    state.next.resolve("a");
    await a;
    cache.invalidate();
    const b = cache.get("b", builder());
    state.next.resolve("b");
    assert.equal(await b, "b");
  });

  it("does nothing to invalidate when there is nothing cached", () => {
    const { cache, state } = tracked();
    cache.invalidate();
    mock.timers.tick(10000);
    assert.equal(state.builds, 0);
  });
});
