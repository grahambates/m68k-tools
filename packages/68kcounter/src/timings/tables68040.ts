import type { InstructionStatement } from "../parse/nodes";
import evaluate, { type Variables } from "../parse/evaluate";
import instructionQualifier from "../parse/instructionQualifier";
import { mnemonicGroups } from "../syntax";
import type { InstructionTiming } from ".";
import {
  cachedOperands,
  type CachedMode,
  type CachedOperand,
} from "./cachedOperands";

// MC68040UM §10.4–6. Each row retains [EA calculate, execute lead, execute base].
// https://www.nxp.com/docs/en/reference-manual/MC68040UM.pdf
// The displayed reference cost is the published execute column (lead + base),
// not the sum of pipeline stages. No overlap or write-back latency is simulated.
type Stage = [number, number, number];
type StageTable = Partial<Record<CachedMode, Stage>>;
const modes: CachedMode[] = [
  "dn",
  "an",
  "indirect",
  "postinc",
  "predec",
  "disp",
  "pcdisp",
  "absolute",
  "immediate",
  "index",
  "pcindex",
  "full",
  "pre",
  "preOuter",
  "post",
  "postOuter",
];
const table = (values: (Stage | null)[]): StageTable =>
  Object.fromEntries(values.flatMap((v, i) => (v ? [[modes[i], v]] : [])));
const alu = table([
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [3, 2, 1],
  [1, 0, 1],
  [1, 0, 1],
  [3, 0, 3],
  [5, 1, 4],
  [7, 1, 6],
  [10, 1, 9],
  [11, 1, 11],
  [11, 3, 8],
  [12, 3, 10],
]);
const compare = table([
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [3, 2, 1],
  [1, 0, 1],
  [1, 0, 1],
  [3, 0, 3],
  [5, 1, 4],
  [7, 1, 6],
  [9, 1, 8],
  [10, 1, 9],
  [10, 3, 7],
  [11, 3, 8],
]);
const immediate = table([
  [1, 0, 1],
  null,
  [1, 0, 1],
  [2, 1, 1],
  [2, 1, 1],
  [2, 1, 1],
  null,
  [2, 1, 1],
  null,
  [3, 0, 3],
  null,
  [8, 1, 7],
  [10, 1, 10],
  [11, 1, 11],
  [11, 3, 9],
  [12, 3, 10],
]);
const quick = table([
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [2, 1, 1],
  [2, 1, 1],
  [2, 1, 1],
  null,
  [1, 0, 1],
  null,
  [3, 0, 3],
  null,
  [8, 1, 7],
  [10, 1, 9],
  [11, 1, 11],
  [11, 3, 8],
  [12, 3, 10],
]);
const cmpa = table([
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [2, 1, 1],
  [2, 1, 1],
  [2, 1, 1],
  [3, 2, 1],
  [1, 0, 1],
  [1, 0, 1],
  [3, 0, 3],
  [5, 1, 4],
  [7, 1, 6],
  [9, 1, 8],
  [10, 1, 9],
  [10, 3, 7],
  [11, 3, 8],
]);
const cmpi = table([
  [1, 0, 1],
  null,
  [1, 0, 1],
  [2, 1, 1],
  [2, 1, 1],
  [2, 1, 1],
  [3, 2, 1],
  [2, 1, 1],
  null,
  [3, 0, 3],
  [5, 2, 4],
  [7, 2, 6],
  [9, 2, 8],
  [10, 2, 9],
  [10, 4, 7],
  [11, 4, 8],
]);
const adda = table([
  [1, 0, 2],
  [1, 0, 1],
  [1, 0, 2],
  [2, 1, 2],
  [2, 1, 2],
  [2, 1, 2],
  [3, 2, 2],
  [1, 0, 2],
  [1, 0, 1],
  [4, 0, 5],
  [5, 1, 5],
  [7, 1, 7],
  [10, 1, 10],
  [11, 1, 12],
  [11, 3, 9],
  [12, 3, 11],
]);
const suba = table([
  [1, 0, 1],
  [1, 0, 2],
  [1, 0, 2],
  [2, 1, 2],
  [2, 1, 2],
  [2, 1, 2],
  [3, 2, 2],
  [1, 0, 2],
  [1, 0, 2],
  [4, 0, 5],
  [5, 1, 5],
  [7, 1, 7],
  [9, 1, 9],
  [10, 1, 10],
  [10, 3, 8],
  [11, 3, 9],
]);
const unary = table([
  [1, 0, 1],
  null,
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  null,
  [1, 0, 1],
  null,
  [3, 0, 3],
  null,
  [7, 1, 6],
  [9, 1, 8],
  [10, 1, 9],
  [10, 3, 7],
  [11, 3, 8],
]);
const scc = table([
  [1, 0, 2],
  null,
  [1, 0, 2],
  [1, 0, 2],
  [1, 0, 2],
  [1, 0, 2],
  null,
  [1, 0, 2],
  null,
  [4, 0, 5],
  null,
  [7, 1, 7],
  [10, 1, 10],
  [11, 1, 11],
  [11, 3, 9],
  [12, 3, 10],
]);
const lea = table([
  null,
  null,
  [1, 0, 1],
  null,
  null,
  [2, 1, 1],
  [4, 3, 1],
  [1, 0, 1],
  null,
  [4, 0, 4],
  [5, 1, 4],
  [7, 1, 6],
  [9, 1, 8],
  [10, 1, 9],
  [10, 3, 7],
  [11, 3, 8],
]);
const pea = table([
  null,
  null,
  [2, 1, 1],
  null,
  null,
  [2, 1, 1],
  [4, 3, 1],
  [2, 1, 1],
  null,
  [4, 1, 3],
  [6, 2, 4],
  [8, 2, 6],
  [10, 2, 8],
  [11, 2, 9],
  [11, 4, 7],
  [12, 4, 8],
]);
const jump = table([
  null,
  null,
  [3, 2, 1],
  null,
  null,
  [4, 3, 1],
  [6, 5, 1],
  [3, 2, 1],
  null,
  [6, 0, 6],
  [7, 1, 6],
  [9, 1, 8],
  [12, 1, 11],
  [12, 1, 11],
  [13, 3, 10],
  [14, 3, 11],
]);
const jsr = table([
  null,
  null,
  [3, 2, 1],
  null,
  null,
  [4, 3, 1],
  [6, 5, 1],
  [3, 2, 1],
  null,
  [6, 0, 6],
  [7, 1, 6],
  [9, 1, 8],
  [12, 1, 11],
  [13, 1, 12],
  [13, 3, 10],
  [14, 3, 11],
]);
const movea = table([
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [1, 0, 1],
  [3, 2, 1],
  [1, 0, 1],
  [1, 0, 1],
  [4, 0, 4],
  [5, 1, 4],
  [7, 1, 6],
  [10, 1, 9],
  [11, 1, 10],
  [11, 3, 8],
  [12, 3, 9],
]);
const divWord = table([
  [8, 0, 27],
  null,
  [8, 0, 27],
  [8, 0, 27],
  [8, 0, 27],
  [8, 0, 27],
  [11, 3, 27],
  [8, 0, 27],
  [8, 0, 27],
  [11, 0, 30],
  [12, 1, 30],
  [14, 1, 32],
  [17, 1, 35],
  [18, 1, 36],
  [18, 3, 34],
  [19, 3, 35],
]);
const divLong = table([
  [9, 0, 44],
  null,
  [9, 0, 44],
  [9, 0, 44],
  [9, 0, 44],
  [11, 2, 44],
  [12, 3, 44],
  [11, 2, 44],
  [10, 1, 44],
  [12, 0, 47],
  [13, 1, 47],
  [15, 1, 49],
  [18, 1, 52],
  [19, 1, 53],
  [19, 3, 51],
  [20, 3, 52],
]);

const reference = {
  cpu: "68040",
  cache: "instruction-and-data",
  accesses: "operand",
  basis: "execution-stage",
} as const;
function result(
  stage: Stage,
  reads = 0,
  writes = 0,
  note?: string,
): InstructionTiming {
  const [calculate, executeLead, executeBase] = stage;
  return {
    values: [[executeLead + executeBase, reads, writes]],
    labels: [],
    reference: {
      ...reference,
      stages: { calculate, executeLead, executeBase },
      ...(note ? { note } : {}),
    },
  };
}
const read = (o: CachedOperand) => Number(o.memory) + o.pointerReads;
const reg = (o: CachedOperand) => o.mode === "dn" || o.mode === "an";
const stageFor = (t: StageTable, ea: CachedOperand): Stage | undefined => {
  const stage = t[ea.mode];
  if (!stage) return undefined;
  // §10.1: full-format PC bases add one calculate clock and one lead clock.
  return ea.pc && !["pcdisp", "pcindex"].includes(ea.mode)
    ? [stage[0] + 1, stage[1] + 1, stage[2]]
    : stage;
};

const moveDestinations: CachedMode[] = [
  "dn",
  "indirect",
  "postinc",
  "predec",
  "disp",
  "absolute",
  "index",
  "full",
  "pre",
  "preOuter",
  "post",
  "postOuter",
];
const move: Partial<Record<CachedMode, [number[], number[]]>> = {
  dn: [
    [1, 1, 1, 1, 1, 1, 3, 7, 10, 11, 11, 12],
    [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 3, 3],
  ],
  indirect: [
    [1, 1, 2, 2, 2, 1, 4, 7, 10, 11, 11, 12],
    [0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 3, 3],
  ],
  postinc: [
    [1, 2, 2, 2, 2, 2, 4, 7, 10, 11, 11, 12],
    [0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 3, 3],
  ],
  predec: [
    [1, 2, 2, 2, 2, 2, 4, 7, 10, 11, 11, 12],
    [0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 3, 3],
  ],
  disp: [
    [1, 2, 2, 2, 2, 2, 4, 7, 10, 11, 11, 12],
    [0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 3, 3],
  ],
  pcdisp: [
    [3, 3, 3, 3, 4, 4, 8, 10, 13, 14, 14, 15],
    [2, 2, 2, 2, 3, 3, 4, 4, 4, 4, 6, 6],
  ],
  absolute: [
    [1, 1, 2, 2, 2, 2, 4, 7, 10, 11, 11, 12],
    [0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 3, 3],
  ],
  immediate: [
    [1, 1, 2, 2, 2, 2, 3, 7, 10, 11, 11, 12],
    [0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 3, 3],
  ],
  index: [
    [3, 4, 5, 5, 5, 5, 8, 10, 13, 14, 14, 15],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  pcindex: [
    [5, 5, 6, 6, 6, 6, 9, 11, 14, 15, 15, 16],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],
  full: [
    [7, 7, 8, 8, 8, 8, 11, 13, 16, 17, 17, 18],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],
  pre: [
    [10, 10, 11, 11, 11, 11, 14, 16, 19, 20, 20, 21],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],
  preOuter: [
    [11, 11, 12, 12, 12, 12, 15, 17, 20, 21, 21, 22],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],
  post: [
    [11, 11, 12, 12, 12, 12, 15, 17, 20, 21, 21, 22],
    [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  ],
  postOuter: [
    [12, 12, 13, 13, 13, 13, 16, 18, 21, 22, 22, 23],
    [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  ],
};

export function timings68040(
  statement: InstructionStatement,
  vars: Variables,
): InstructionTiming | null {
  const op = statement.opcode.op.name,
    q = instructionQualifier(statement);
  const operands = cachedOperands(statement, vars);
  if (!operands) return null;
  const [s, d] = operands;
  const bwl = q === "B" || q === "W" || q === "L";
  if (
    ["DIVS", "DIVU"].includes(op) &&
    s?.mode === "immediate" &&
    evaluate(statement.operands[0].text, vars) === 0
  )
    return null;
  const lookup = (
    t: StageTable,
    ea: CachedOperand,
    reads: number,
    writes = 0,
    note?: string,
  ) => {
    const stage = stageFor(t, ea);
    return stage ? result(stage, reads, writes, note) : null;
  };
  if (!operands.length) {
    if (op === "NOP")
      return result(
        [8, 1, 7],
        0,
        0,
        "Minimum synchronising cost; outstanding work can add delay.",
      );
    if (op === "RTS") return result([5, 0, 5], 1);
    if (op === "RTR") return result([7, 1, 6], 2);
    return null;
  }
  if (mnemonicGroups.BCC.includes(op) && operands.length === 1)
    return {
      values: [
        [2, 0, 0],
        [3, 0, 0],
      ],
      labels: ["Taken", "Not taken"],
      reference,
    };
  if (op === "BRA" && operands.length === 1) return result([2, 0, 2]);
  if (op === "BSR" && operands.length === 1) return result([2, 1, 1], 0, 1);
  if (
    mnemonicGroups.DBCC.includes(op) &&
    operands.length === 2 &&
    s.mode === "dn"
  )
    return {
      values: [
        [3, 0, 0],
        [4, 0, 0],
        [4, 0, 0],
      ],
      labels: ["Taken", "Condition true", "Expired"],
      reference,
    };
  if (op === "RTD" && operands.length === 1 && s.mode === "immediate")
    return result([6, 1, 5], 1);
  if (op === "UNLK" && operands.length === 1 && s.mode === "an")
    return result([2, 1, 1], 1);
  if (
    op === "LINK" &&
    operands.length === 2 &&
    s.mode === "an" &&
    d.mode === "immediate"
  )
    return result([3, 2, 1], 0, 1);
  if (
    ["LEA", "PEA", "JMP", "JSR"].includes(op) &&
    s.control &&
    operands.length === (op === "LEA" ? 2 : 1)
  ) {
    if (op === "LEA" && d.mode !== "an") return null;
    return lookup(
      op === "LEA" ? lea : op === "PEA" ? pea : op === "JMP" ? jump : jsr,
      s,
      s.pointerReads,
      Number(op === "JSR" || op === "PEA"),
    );
  }
  if (op === "MOVEM" && operands.length === 2 && (q === "W" || q === "L")) {
    const load = d.mode === "list" || reg(d);
    const ea = load ? s : d,
      list = load ? d : s;
    if (
      !ea.memory ||
      (load && (ea.mode === "predec" || q === "W")) ||
      (!load && (!ea.writable || ea.mode === "postinc"))
    )
      return null;
    const registers =
      list.node.type === "register-list"
        ? list.node.registers
        : list.node.type === "data-register" ||
            list.node.type === "address-register"
          ? [list.node.register]
          : [];
    if (!registers.length) return null;
    const data = registers.filter((r) => r.startsWith("d")).length;
    const count = Math.max(1, data) + registers.length - data;
    // §10.6 p.10-23: D' is at least one even for an address-only list.
    const costs: Partial<Record<CachedMode, [number, number]>> = {
      indirect: [load ? 3 : 2, 1],
      postinc: [3, 1],
      predec: [2, 1],
      disp: [load ? 3 : 2, 1],
      absolute: [load ? 3 : 2, 1],
      pcdisp: [4, 2],
      index: [load ? 10 : 9, 2],
      pcindex: [11, 3],
      full: [load ? 13 : 12, 3],
      pre: [load ? 16 : 15, 3],
      preOuter: [load ? 17 : 16, 3],
      post: [load ? 17 : 16, 5],
      postOuter: [load ? 18 : 17, 5],
    };
    const cost = costs[ea.mode];
    if (!cost) return null;
    const pc = Number(ea.pc && !["pcdisp", "pcindex"].includes(ea.mode));
    const total = cost[0] + count + pc,
      lead = cost[1] + pc;
    return result(
      [total, lead, total - lead],
      ea.pointerReads + (load ? registers.length : 0),
      load ? 0 : registers.length,
    );
  }
  if (
    operands.length === 2 &&
    bwl &&
    ["MOVE", "MOVEA"].includes(op) &&
    d.writable &&
    s.mode !== "list"
  ) {
    if ((s.mode === "an" || d.mode === "an") && q === "B") return null;
    if (d.mode === "an") {
      const stage = stageFor(movea, s);
      if (!stage) return null;
      return result(
        [
          stage[0],
          stage[1],
          stage[2] + Number(q === "W" && !["dn", "immediate"].includes(s.mode)),
        ],
        read(s),
      );
    }
    if (op === "MOVEA") return null;
    const row = move[s.mode === "an" ? "dn" : s.mode],
      column = moveDestinations.indexOf(d.mode);
    if (!row || column === -1) return null;
    const extra = Number(s.pc && !["pcdisp", "pcindex"].includes(s.mode));
    const total = row[0][column] + extra,
      lead = row[1][column] + extra;
    return result(
      [total, lead, total - lead],
      read(s) + d.pointerReads,
      Number(d.memory),
    );
  }
  if (
    op === "MOVEQ" &&
    operands.length === 2 &&
    s.mode === "immediate" &&
    d.mode === "dn" &&
    q === "L"
  )
    return result([1, 0, 1]);
  if (op === "EXG" && operands.length === 2 && reg(s) && reg(d))
    return result(s.mode === "an" && d.mode === "an" ? [2, 1, 1] : [1, 0, 1]);
  if (
    ["EXT", "EXTB", "SWAP"].includes(op) &&
    operands.length === 1 &&
    s.mode === "dn"
  )
    return result([1, 0, op === "SWAP" || (op === "EXT" && q === "W") ? 2 : 1]);
  if (
    operands.length === 2 &&
    bwl &&
    ["ADD", "SUB", "AND", "OR", "EOR", "CMP", "ADDA", "SUBA", "CMPA"].includes(
      op,
    )
  ) {
    if (op === "CMPA" && q !== "L") return null;
    if (["ADDA", "SUBA", "CMPA"].includes(op))
      return d.mode === "an" && q !== "B"
        ? lookup(
            op === "ADDA"
              ? adda
              : op === "SUBA"
                ? suba
                : q === "L"
                  ? cmpa
                  : adda,
            s,
            read(s),
          )
        : null;
    if (d.mode === "dn" && s.mode !== "list")
      return lookup(op === "CMP" ? compare : alu, s, read(s));
    if (op !== "CMP" && s.mode === "dn" && d.memory && d.writable)
      return lookup(alu, d, read(d), 1);
  }
  if (
    operands.length === 2 &&
    bwl &&
    ["ADDI", "SUBI", "ANDI", "ORI", "EORI", "CMPI", "ADDQ", "SUBQ"].includes(
      op,
    ) &&
    s.mode === "immediate" &&
    (d.writable || op === "CMPI")
  ) {
    if (d.mode === "an" && (q === "B" || !["ADDQ", "SUBQ"].includes(op)))
      return null;
    return lookup(
      op === "CMPI" ? cmpi : ["ADDQ", "SUBQ"].includes(op) ? quick : immediate,
      d,
      read(d),
      Number(d.memory && op !== "CMPI"),
    );
  }
  if (
    operands.length === 1 &&
    bwl &&
    ["CLR", "NEG", "NEGX", "NOT", "TST"].includes(op) &&
    (s.mode === "dn" || (s.memory && (s.writable || op === "TST")))
  )
    return lookup(
      op === "TST" ? alu : unary,
      s,
      op === "CLR" ? s.pointerReads : read(s),
      Number(s.memory && op !== "TST"),
    );
  if (
    operands.length === 1 &&
    mnemonicGroups.SCC.includes(op) &&
    (s.mode === "dn" || (s.memory && s.writable))
  )
    return lookup(scc, s, s.pointerReads, Number(s.memory));
  if (
    operands.length === 2 &&
    ["DIVS", "DIVU"].includes(op) &&
    d.mode === "dn" &&
    (q === "W" || q === "L")
  )
    return lookup(
      q === "W" ? divWord : divLong,
      s,
      read(s),
      0,
      "Division reference excludes divide-by-zero exceptions.",
    );
  if (
    operands.length === 2 &&
    ["MULS", "MULU"].includes(op) &&
    d.mode === "dn" &&
    (q === "W" || q === "L") &&
    s.mode !== "an" &&
    s.mode !== "list"
  ) {
    // §10.6 p.10-25: word / long operand-size columns.
    const base = q === "L" ? 20 : op === "MULS" ? 16 : 14;
    const adjustment: Partial<Record<CachedMode, Stage>> = {
      dn: [1, 0, 0],
      indirect: [1, 0, 0],
      postinc: [1, 0, 0],
      predec: [1, 0, 0],
      disp: [q === "L" ? 2 : 1, 0, 0],
      absolute: [q === "L" ? 2 : 1, 0, 0],
      immediate: [1, 0, 0],
      pcdisp: [3, op === "MULS" ? 2 : 0, 0],
      index: [3, 0, 2],
      pcindex: [5, 1, 3],
      full: [7, 1, 5],
      pre: [9, 1, 7],
      preOuter: [10, 1, 8],
      post: [10, 3, 6],
      postOuter: [11, 3, 7],
    };
    const stage = stageFor(adjustment, s);
    return stage
      ? result([stage[0], stage[1], base + stage[2]], read(s))
      : null;
  }
  if (
    mnemonicGroups.SHIFT.includes(op) &&
    operands.length === 2 &&
    bwl &&
    ["dn", "immediate"].includes(s.mode) &&
    d.mode === "dn"
  ) {
    const base =
      op === "ASL" || ["ROL", "ROR"].includes(op)
        ? 3
        : ["ROXL", "ROXR"].includes(op)
          ? 5
          : 2;
    return result([1, 0, base + Number(s.mode === "dn")]);
  }
  if (
    ["ADDX", "SUBX", "ABCD", "SBCD", "CMPM"].includes(op) &&
    operands.length === 2 &&
    bwl
  ) {
    const decimal = op === "ABCD" || op === "SBCD";
    if (op !== "CMPM" && s.mode === "dn" && d.mode === "dn")
      return result([1, 0, decimal ? 3 : 1]);
    const mode = op === "CMPM" ? "postinc" : "predec";
    if (s.mode === mode && d.mode === mode)
      return result([3, 1, decimal ? 3 : 2], 2, op === "CMPM" ? 0 : 1);
  }
  // Additional families require their own stage tables; never borrow 030 costs.
  return null;
}
