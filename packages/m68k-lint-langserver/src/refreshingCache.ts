/**
 * A cache that serves what it has while it makes something better.
 *
 * Some things are expensive to rebuild and nearly right when they are out of
 * date: the project index takes seconds on a large project, and after one file
 * is saved the old one differs from the new only in what that file changed
 * across files. Throwing it away makes the next request wait for the rebuild.
 * Here the old value is `invalidate`d instead: it keeps being served, and a
 * rebuild runs in the background.
 *
 * The rebuild waits for things to go quiet. Invalidations that keep arriving,
 * such as a save after every pause in typing, are one rebuild after the last of
 * them and not one each. One that is already running is not interrupted, so
 * something is always finishing; if it was invalidated again meanwhile, one
 * more follows straight away. `onRefreshed` is called when a rebuild has
 * caught up with everything asked for so far, so the caller redoes what it did
 * with the old value once, and not for one that is already out of date.
 *
 * A value that was never built has nothing to serve, so the first `get` waits.
 * `clear` is for when the old value is wrong, not just out of date: nothing of
 * it is served afterwards, and a rebuild that was in flight is discarded.
 */
export interface RefreshingCacheOptions {
  /** Called when a refresh has brought a value up to date. */
  onRefreshed?: () => void;
  /** How long after the last invalidation a rebuild starts. Default 2000. */
  quietMs?: number;
}

interface Entry<V> {
  value: Promise<V>;
  /** Builds a new value; the one given to the latest `get`, which sees the latest state. */
  build: () => Promise<V>;
  /** Bumped by each `invalidate`, so one that lands during a rebuild is not lost. */
  wanted: number;
  /** The `wanted` the value was built for. */
  built: number;
  refreshing: boolean;
}

export class RefreshingCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly onRefreshed: () => void;
  private readonly quietMs: number;
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: RefreshingCacheOptions = {}) {
    this.onRefreshed = options.onRefreshed ?? (() => {});
    this.quietMs = options.quietMs ?? 2000;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * The value for `key`, built if there is none and otherwise served as it is,
   * even if it is out of date. `build` is what a later refresh will use.
   */
  get(key: string, build: () => Promise<V>): Promise<V> {
    const entry = this.entries.get(key);
    if (!entry) return this.set(key, build);
    entry.build = build;
    return entry.value;
  }

  /** Builds the value now and keeps it, for a rebuild the caller is waiting for. */
  set(key: string, build: () => Promise<V>): Promise<V> {
    const value = build();
    const entry: Entry<V> = {
      value,
      build,
      wanted: 0,
      built: 0,
      refreshing: false,
    };
    this.entries.set(key, entry);
    // A build that failed is not worth keeping.
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  /** Marks everything out of date, to be rebuilt once things have been quiet. */
  invalidate(): void {
    if (!this.entries.size) return;
    for (const entry of this.entries.values()) entry.wanted++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const [key, entry] of this.entries)
        if (entry.built !== entry.wanted && !entry.refreshing)
          this.refresh(key, entry);
    }, this.quietMs);
    this.timer.unref?.();
  }

  clear(): void {
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.entries.clear();
  }

  private refresh(key: string, entry: Entry<V>): void {
    const epoch = this.epoch;
    const target = entry.wanted;
    entry.refreshing = true;
    entry.build().then(
      (fresh) => {
        entry.refreshing = false;
        // Cleared while it was building: what it built is for a tree that is gone.
        if (epoch !== this.epoch || this.entries.get(key) !== entry) return;
        // Newer than what was being served, even if it is already behind.
        entry.value = Promise.resolve(fresh);
        entry.built = target;
        if (entry.built === entry.wanted) this.onRefreshed();
        // Invalidated while it was building. If the wait for quiet is over,
        // the follow-up starts now; if not, the timer will start it.
        else if (!this.timer) this.refresh(key, entry);
      },
      () => {
        // The old value keeps being served, and the next invalidation tries again.
        entry.refreshing = false;
      },
    );
  }
}
