import type { InstructionStatement } from "../parse/nodes";
import evaluate, { type Variables } from "../parse/evaluate";
import instructionQualifier from "../parse/instructionQualifier";
import { mnemonicGroups } from "../syntax";
import type { InstructionTiming } from ".";
import { rangeN } from ".";
import { cachedOperands, type CachedOperand } from "./cachedOperands";

// MC68060UM §10.4–14. Cached, aligned operands; no dispatch/overlap analysis.
// https://www.nxp.com/docs/en/data-sheet/MC68060UM.pdf
// Counts are operand accesses, NOT external bus transfers.
const reference = {
  cpu: "68060",
  cache: "instruction-and-data",
  accesses: "operand",
  basis: "instruction-execution",
} as const;
const result = (
  clocks: number,
  reads = 0,
  writes = 0,
  note?: string,
): InstructionTiming => ({
  values: [[clocks, reads, writes]],
  labels: [],
  reference: { ...reference, ...(note ? { note } : {}) },
});
const read = (o: CachedOperand) => Number(o.memory) + o.pointerReads;
const reg = (o: CachedOperand) => o.mode === "dn" || o.mode === "an";
const simple = (o: CachedOperand) =>
  ["dn", "an", "indirect", "postinc", "predec", "disp", "pcdisp"].includes(
    o.mode,
  );
const immediateExtra = (o: CachedOperand) =>
  o.memory && !["indirect", "postinc", "predec"].includes(o.mode) ? 1 : 0;

export function timings68060(
  statement: InstructionStatement,
  vars: Variables,
): InstructionTiming | null {
  const op = statement.opcode.op.name;
  const operands = cachedOperands(statement, vars);
  if (!operands) return null;
  const [s, d] = operands;
  const q = instructionQualifier(statement);
  const bwl = q === "B" || q === "W" || q === "L";
  if (
    ["DIVS", "DIVU"].includes(op) &&
    s?.mode === "immediate" &&
    evaluate(statement.operands[0].text, vars) === 0
  )
    return null;
  const outcomes = (
    clocks: number[],
    labels: string[],
    reads = 0,
    writes = 0,
    extra = 0,
  ): InstructionTiming => ({
    values: clocks.map((c) => [c + extra, reads, writes]),
    labels,
    reference: {
      ...reference,
      note: "Branch prediction state is unknown; outcomes are alternatives, not measured bounds.",
    },
  });
  if (mnemonicGroups.BCC.includes(op) && operands.length === 1)
    return outcomes(
      [7, 1, 3, 7, 0, 1, 7],
      [
        "Unpredicted forward taken",
        "Unpredicted forward not taken",
        "Unpredicted backward taken",
        "Unpredicted backward not taken",
        "Predicted taken",
        "Predicted not taken",
        "Mispredicted",
      ],
    );
  if (["BRA", "BSR"].includes(op) && operands.length === 1)
    return outcomes(
      [3, op === "BRA" ? 0 : 1],
      ["Unpredicted", "Predicted"],
      0,
      op === "BSR" ? 1 : 0,
    );
  if (
    mnemonicGroups.DBCC.includes(op) &&
    operands.length === 2 &&
    s.mode === "dn"
  ) {
    const always = op === "DBF";
    return outcomes(
      [3, always ? 7 : 8, always ? 1 : 2, always ? 7 : 8],
      [
        "Unpredicted taken",
        "Unpredicted not taken",
        "Predicted",
        "Mispredicted",
      ],
    );
  }
  if (!operands.length) {
    if (op === "NOP")
      return result(
        9,
        0,
        0,
        "Synchronising instruction; reference cost excludes additional outstanding work.",
      );
    if (op === "RTS") return result(7, 1);
    if (op === "RTR") return result(8, 2);
    return null;
  }
  if (op === "RTD" && operands.length === 1 && s.mode === "immediate")
    return result(7, 1);
  if (op === "UNLK" && operands.length === 1 && s.mode === "an")
    return result(1, 1);
  if (
    ["JMP", "JSR", "LEA", "PEA"].includes(op) &&
    s.control &&
    operands.length === (op === "LEA" ? 2 : 1)
  ) {
    if (op === "LEA")
      return d.mode === "an" ? result(1 + s.ea060, s.pointerReads) : null;
    if (op === "PEA")
      return result(
        1 +
          s.ea060 +
          Number(
            ["disp", "index", "pcindex"].includes(s.mode) ||
              (s.mode === "full" && !s.pc),
          ),
        s.pointerReads,
        1,
      );
    const writes = op === "JSR" ? 1 : 0;
    if (["pcdisp", "absolute"].includes(s.mode))
      return outcomes(
        [3, writes],
        ["Unpredicted", "Predicted"],
        s.pointerReads,
        writes,
        s.ea060,
      );
    return result(5 + s.ea060, s.pointerReads, writes);
  }
  if (
    op === "LINK" &&
    operands.length === 2 &&
    s.mode === "an" &&
    d.mode === "immediate"
  )
    return result(2, 0, 1);
  if (op === "MOVEM" && operands.length === 2 && (q === "W" || q === "L")) {
    const load = d.mode === "list" || reg(d);
    const ea = load ? s : d,
      list = load ? d : s;
    if (
      !ea.memory ||
      (!load && !ea.writable) ||
      (!load && ea.mode === "postinc") ||
      (load && ea.mode === "predec")
    )
      return null;
    if (list.mode !== "list" && !reg(list)) return null;
    const n = rangeN(statement.operands[load ? 1 : 0].text);
    const extra = simple(ea) ? 0 : 1 + ea.ea060;
    return result(n + extra, ea.pointerReads + (load ? n : 0), load ? 0 : n);
  }
  if (
    operands.length === 2 &&
    ["MOVE", "MOVEA"].includes(op) &&
    bwl &&
    d.writable &&
    s.mode !== "list"
  ) {
    if ((s.mode === "an" || d.mode === "an") && q === "B") return null;
    if (op === "MOVEA" && d.mode !== "an") return null;
    return result(
      1 +
        s.ea060 +
        d.ea060 +
        Number(s.memory && d.memory) +
        (s.mode === "immediate" ? immediateExtra(d) : 0),
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
    return result(1);
  if (op === "EXG" && operands.length === 2 && reg(s) && reg(d))
    return result(1);
  if (
    ["EXT", "EXTB", "SWAP"].includes(op) &&
    operands.length === 1 &&
    s.mode === "dn"
  )
    return result(1);
  if (
    operands.length === 2 &&
    bwl &&
    [
      "ADD",
      "SUB",
      "AND",
      "OR",
      "EOR",
      "CMP",
      "ADDA",
      "SUBA",
      "CMPA",
      "MULS",
      "MULU",
      "DIVS",
      "DIVU",
    ].includes(op)
  ) {
    const addressOp = ["ADDA", "SUBA", "CMPA"].includes(op);
    const multiply = op === "MULS" || op === "MULU";
    const divide = op === "DIVS" || op === "DIVU";
    if (addressOp ? d.mode !== "an" || q === "B" : d.mode !== "dn") {
      if (
        !addressOp &&
        !multiply &&
        !divide &&
        op !== "CMP" &&
        s.mode === "dn" &&
        d.memory &&
        d.writable
      )
        return result(1 + d.ea060, read(d), 1);
      return null;
    }
    if (
      s.mode === "list" ||
      ((multiply || divide) && (s.mode === "an" || q === "B"))
    )
      return null;
    let clocks = multiply ? 2 : divide ? (q === "L" ? 38 : 22) : 1;
    if ((multiply || divide) && q === "L" && !simple(s)) clocks++;
    if (
      addressOp &&
      (s.node.type === "address-register-indirect-postinc" ||
        s.node.type === "address-register-indirect-predec") &&
      d.node.type === "address-register" &&
      s.node.register.type === "address-register" &&
      s.node.register.register === d.node.register
    )
      clocks++;
    return result(
      clocks + s.ea060,
      read(s),
      0,
      divide
        ? "Division reference excludes exceptions; word divide uses its maximum execution cost."
        : undefined,
    );
  }
  if (
    operands.length === 2 &&
    bwl &&
    ["ADDI", "SUBI", "ANDI", "ORI", "EORI", "CMPI", "ADDQ", "SUBQ"].includes(
      op,
    ) &&
    s.mode === "immediate" &&
    (d.mode === "dn" ||
      (d.memory && (d.writable || op === "CMPI")) ||
      (["ADDQ", "SUBQ"].includes(op) && d.mode === "an" && q !== "B"))
  ) {
    const quick = op === "ADDQ" || op === "SUBQ";
    return result(
      1 + d.ea060 + (quick ? 0 : immediateExtra(d)),
      read(d),
      Number(d.memory && op !== "CMPI"),
    );
  }
  if (
    operands.length === 1 &&
    bwl &&
    (["CLR", "NEG", "NEGX", "NOT", "NBCD", "TST"].includes(op) ||
      mnemonicGroups.SCC.includes(op)) &&
    (s.mode === "dn" || (s.memory && (s.writable || op === "TST")))
  )
    return result(
      1 + s.ea060,
      op === "CLR" || mnemonicGroups.SCC.includes(op)
        ? s.pointerReads
        : read(s),
      Number(s.memory && op !== "TST"),
    );
  if (mnemonicGroups.SHIFT.includes(op)) {
    if (
      operands.length === 2 &&
      bwl &&
      ["dn", "immediate"].includes(s.mode) &&
      d.mode === "dn"
    )
      return result(1);
    if (operands.length === 1 && q === "W" && s.memory && s.writable)
      return result(1 + s.ea060, read(s), 1);
  }
  if (
    ["BTST", "BCHG", "BCLR", "BSET"].includes(op) &&
    operands.length === 2 &&
    ["dn", "immediate"].includes(s.mode) &&
    (d.mode === "dn" || (d.memory && (d.writable || op === "BTST")))
  )
    return result(
      1 + d.ea060 + (s.mode === "immediate" ? immediateExtra(d) : 0),
      read(d),
      Number(d.memory && op !== "BTST"),
    );
  if (
    ["ADDX", "SUBX", "ABCD", "SBCD", "CMPM"].includes(op) &&
    operands.length === 2 &&
    bwl
  ) {
    if (op !== "CMPM" && s.mode === "dn" && d.mode === "dn") return result(1);
    const mode = op === "CMPM" ? "postinc" : "predec";
    if (s.mode === mode && d.mode === mode)
      return result(2, 2, op === "CMPM" ? 0 : 1);
  }
  // No inherited timings for emulated forms, FPU/MMU, cache maintenance,
  // locked external accesses, bitfields or other unimplemented table families.
  return null;
}
