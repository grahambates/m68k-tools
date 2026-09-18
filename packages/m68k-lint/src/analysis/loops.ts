import type { ControlFlowGraph } from "./cfg.js";

export interface Loop {
  /** Every line in the loop, in source order. */
  readonly members: readonly number[];
  /** Control-flow edges leaving the loop. */
  readonly exits: readonly { from: number; to: number }[];
}

/**
 * The loops in a control-flow graph: its strongly connected components that
 * contain a cycle. A component is a maximal set of lines that can all reach one
 * another, so a nested loop belongs to the outer loop's component rather than
 * being reported separately, which is what a question about "the way out" needs.
 *
 * Iterative Tarjan, since a long routine would overflow the call stack
 * otherwise.
 */
export function findLoops(cfg: ControlFlowGraph): Loop[] {
  const count = cfg.successors.length;
  const order = new Array<number>(count).fill(-1);
  const low = new Array<number>(count).fill(0);
  const onStack = new Array<boolean>(count).fill(false);
  const stack: number[] = [];
  const loops: Loop[] = [];
  let next = 0;

  for (let root = 0; root < count; root++) {
    if (order[root] !== -1) continue;
    const work: { node: number; edges: number[]; at: number }[] = [
      { node: root, edges: [...cfg.successors[root]], at: 0 },
    ];
    order[root] = low[root] = next++;
    stack.push(root);
    onStack[root] = true;

    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.at < frame.edges.length) {
        const to = frame.edges[frame.at++];
        if (order[to] === -1) {
          order[to] = low[to] = next++;
          stack.push(to);
          onStack[to] = true;
          work.push({ node: to, edges: [...cfg.successors[to]], at: 0 });
        } else if (onStack[to]) {
          low[frame.node] = Math.min(low[frame.node], order[to]);
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent)
        low[parent.node] = Math.min(low[parent.node], low[frame.node]);
      if (low[frame.node] !== order[frame.node]) continue;

      const members: number[] = [];
      let member: number;
      do {
        member = stack.pop()!;
        onStack[member] = false;
        members.push(member);
      } while (member !== frame.node);

      const selfLoop =
        members.length === 1 && cfg.successors[members[0]].has(members[0]);
      if (members.length < 2 && !selfLoop) continue;

      members.sort((a, b) => a - b);
      const inside = new Set(members);
      const exits: Loop["exits"][number][] = [];
      for (const from of members)
        for (const to of cfg.successors[from])
          if (!inside.has(to)) exits.push({ from, to });
      loops.push({ members, exits });
    }
  }

  return loops;
}
