import {
  deleteVariable,
  lookupVariable,
  setVariable,
  variableKey,
  type Variables,
} from "./variables";

/** What is known of the constants a conditional block assigns. */
interface Frame {
  /** The value each assigned constant had before the block, or undefined. */
  before: Map<string, number | undefined>;
  /** The value each assigned constant had at the end of each arm finished so far. */
  arms: Map<string, number | undefined>[];
  /** Whether the block has an ELSE, so one arm always runs. */
  hasElse: boolean;
}

/**
 * The constants assigned in conditional assembly.
 *
 * The counter shows every arm of a conditional, since it counts each path, but
 * a constant defined one way in one arm and another in the next has no single
 * value afterwards, and taking the last would size everything that uses it
 * after the block by the wrong one. A constant that ends a block with the same
 * value however it was reached keeps it; one that does not is unknown, so what
 * depends on it is unknown too, not a guess. Only assignments count: a label's
 * value is its offset, which every arm contributes to by design.
 */
export class ConditionalConstants {
  private frames: Frame[] = [];

  /** Start again, as at the beginning of a pass over the source. */
  reset(): void {
    this.frames = [];
  }

  /** An IF, of any kind, opens a block. */
  open(): void {
    this.frames.push({ before: new Map(), arms: [], hasElse: false });
  }

  /** ELSE or ELSEIF ends an arm; the next one starts from what was known before. */
  next(vars: Variables, isElse: boolean): void {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) return;
    frame.arms.push(this.current(frame, vars));
    for (const [key, value] of frame.before) this.restore(vars, key, value);
    if (isElse) frame.hasElse = true;
  }

  /** ENDC closes the block, settling the constants it assigned. */
  close(vars: Variables): void {
    const frame = this.frames.pop();
    if (!frame) return;
    frame.arms.push(this.current(frame, vars));
    // With no ELSE it may be that no arm ran, leaving what was there before.
    if (!frame.hasElse) frame.arms.push(new Map(frame.before));

    for (const key of frame.before.keys()) {
      const values = frame.arms.map((arm) =>
        arm.has(key) ? arm.get(key) : frame.before.get(key),
      );
      const [first] = values;
      // The block assigns it as far as an enclosing block is concerned.
      this.note(key, frame.before.get(key));
      if (first !== undefined && values.every((value) => value === first))
        setVariable(vars, key, first);
      else deleteVariable(vars, key);
    }
  }

  /** Assign a constant, noting it for the innermost block if there is one. */
  assign(vars: Variables, name: string, value: number): void {
    this.note(variableKey(vars, name), lookupVariable(vars, name));
    setVariable(vars, name, value);
  }

  private note(key: string, before: number | undefined): void {
    const frame = this.frames[this.frames.length - 1];
    if (frame && !frame.before.has(key)) frame.before.set(key, before);
  }

  private current(
    frame: Frame,
    vars: Variables,
  ): Map<string, number | undefined> {
    return new Map(
      [...frame.before.keys()].map((k) => [k, lookupVariable(vars, k)]),
    );
  }

  private restore(vars: Variables, key: string, value: number | undefined) {
    if (value === undefined) deleteVariable(vars, key);
    else setVariable(vars, key, value);
  }
}
