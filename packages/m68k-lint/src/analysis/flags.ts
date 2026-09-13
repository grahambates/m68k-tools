import type { ParsedFile } from "m68k-parser";
import { buildControlFlowGraph, type ControlFlowGraph } from "./cfg.js";
import { FLAGS, getFlagSemantics, type Flag } from "../semantics/flags.js";
import { isExecutableLine } from "../util/ast.js";

export type FlagLiveness = "dead" | "live" | "unknown";

export type FlagDefinition =
  | { kind: "instruction"; index: number }
  | { kind: "entry" }
  | { kind: "unknown" };

function equalDefinitions(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function mergeLiveness(a: FlagLiveness, b: FlagLiveness): FlagLiveness {
  if (a === "live" || b === "live") return "live";
  if (a === "unknown" || b === "unknown") return "unknown";
  return "dead";
}

function transferLiveness(
  after: FlagLiveness,
  reads: boolean,
  writesOrUndefines: boolean,
): FlagLiveness {
  if (reads) return "live";
  if (writesOrUndefines) return "dead";
  return after;
}

export interface FlagAnalysis {
  readonly cfg: ControlFlowGraph;
  isLiveAfter(index: number, flag: Flag): FlagLiveness;
  reachingDefinitionsBefore(
    index: number,
    flag: Flag,
  ): readonly FlagDefinition[];
  reachingDefinitionsAfter(
    index: number,
    flag: Flag,
  ): readonly FlagDefinition[];
}

export function analyzeFlags(file: ParsedFile): FlagAnalysis {
  const cfg = buildControlFlowGraph(file);
  const liveIn = file.lines.map(() => new Map<Flag, FlagLiveness>());
  const liveOut = file.lines.map(() => new Map<Flag, FlagLiveness>());

  for (const map of [...liveIn, ...liveOut]) {
    for (const flag of FLAGS) map.set(flag, "dead");
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = file.lines.length - 1; i >= 0; i--) {
      const line = file.lines[i];
      if (!isExecutableLine(line)) continue;
      const semantics = getFlagSemantics(line);

      for (const flag of FLAGS) {
        let out: FlagLiveness = cfg.escapes[i] ? "unknown" : "dead";
        for (const successor of cfg.successors[i]) {
          out = mergeLiveness(out, liveIn[successor].get(flag) ?? "dead");
        }
        const before =
          semantics.controlFlow === "call"
            ? semantics.reads.has(flag)
              ? "live"
              : "unknown"
            : transferLiveness(
                out,
                semantics.reads.has(flag),
                semantics.writes.has(flag) || semantics.undefined.has(flag),
              );

        if (liveOut[i].get(flag) !== out) {
          liveOut[i].set(flag, out);
          changed = true;
        }
        if (liveIn[i].get(flag) !== before) {
          liveIn[i].set(flag, before);
          changed = true;
        }
      }
    }
  }

  // Forward reaching definitions. Store compact keys during the fixed-point.
  const beforeDefs = file.lines.map(() => new Map<Flag, Set<string>>());
  const afterDefs = file.lines.map(() => new Map<Flag, Set<string>>());
  for (const maps of [beforeDefs, afterDefs]) {
    for (const map of maps)
      for (const flag of FLAGS) map.set(flag, new Set<string>());
  }

  changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (!isExecutableLine(line)) continue;
      const semantics = getFlagSemantics(line);

      for (const flag of FLAGS) {
        const incoming = new Set<string>();
        const preds = cfg.predecessors[i];
        if (preds.size === 0) incoming.add("entry");
        for (const pred of preds) {
          for (const key of afterDefs[pred].get(flag) ?? []) incoming.add(key);
        }

        // Calls are deliberately an unknown boundary for CCR values after the
        // call, even though control returns to the next source instruction.
        const outgoing = new Set(incoming);
        if (semantics.writes.has(flag)) {
          outgoing.clear();
          outgoing.add(`i:${i}`);
        } else if (semantics.undefined.has(flag)) {
          outgoing.clear();
          outgoing.add("unknown");
        }

        const oldBefore = beforeDefs[i].get(flag) ?? new Set<string>();
        if (!equalDefinitions(oldBefore, incoming)) {
          beforeDefs[i].set(flag, incoming);
          changed = true;
        }
        const oldAfter = afterDefs[i].get(flag) ?? new Set<string>();
        if (!equalDefinitions(oldAfter, outgoing)) {
          afterDefs[i].set(flag, outgoing);
          changed = true;
        }
      }
    }
  }

  const decode = (keys: ReadonlySet<string>): FlagDefinition[] =>
    [...keys].map((key) => {
      if (key === "entry") return { kind: "entry" } as const;
      if (key === "unknown") return { kind: "unknown" } as const;
      return { kind: "instruction", index: Number(key.slice(2)) } as const;
    });

  return {
    cfg,
    isLiveAfter(index, flag) {
      return liveOut[index]?.get(flag) ?? "unknown";
    },
    reachingDefinitionsBefore(index, flag) {
      return decode(beforeDefs[index]?.get(flag) ?? new Set<string>());
    },
    reachingDefinitionsAfter(index, flag) {
      return decode(afterDefs[index]?.get(flag) ?? new Set<string>());
    },
  };
}
