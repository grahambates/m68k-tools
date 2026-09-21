/**
 * Remembers the result of linting a document, for the version that was linted.
 *
 * Diagnostics are published after an edit, and then a code-action request
 * arrives for the same text every time the cursor moves. Linting is the
 * expensive part of both, and the answer cannot have changed, so the request
 * gets the result that was already computed. The promise is kept rather than
 * the value, so a request that arrives while the lint is still running waits
 * for it instead of starting a second one.
 *
 * A document's result also depends on things outside it: the other open
 * documents, the project's files, the configuration. Those are the caller's to
 * report, by clearing the cache when any of them change.
 */
export class LintCache<T> {
  private readonly entries = new Map<
    string,
    { version: number; result: Promise<T> }
  >();

  get(uri: string, version: number, compute: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(uri);
    if (hit?.version === version) return hit.result;
    const result = compute();
    this.entries.set(uri, { version, result });
    // A lint that failed is not an answer worth keeping.
    result.catch(() => {
      if (this.entries.get(uri)?.result === result) this.entries.delete(uri);
    });
    return result;
  }

  delete(uri: string): void {
    this.entries.delete(uri);
  }

  clear(): void {
    this.entries.clear();
  }
}
