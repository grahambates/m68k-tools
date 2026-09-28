import type { ParsedLine } from "m68k-parser";
import type { RuleContext } from "../../core/context.js";
import type { Rule } from "../../core/rule.js";
import { findLoops } from "../../analysis/loops.js";
import { analyzeDataRegions } from "../../analysis/data-regions.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { getFlagSemantics } from "../../semantics/flags.js";
import {
  getRegisterSemantics,
  normalizeRegister,
  type Register,
} from "../../semantics/registers.js";
import { instructionSize } from "../../util/ast.js";

const width = (line: ParsedLine) =>
  ({ b: 1, w: 2, l: 4 })[instructionSize(line) as "b" | "w" | "l"];

/** Bounded straight-line setup search; no merging, calls or inferred aliases. */
function setupDefinition(
  ctx: RuleContext,
  entry: number,
  register: Register,
): { line: ParsedLine; index: number } | undefined {
  const { cfg } = ctx.registers;
  let at = entry;
  for (let budget = 0; budget < 64; budget++) {
    const line = ctx.line(at)!;
    const sem = getRegisterSemantics(line);
    if (
      line.inlineCondition ||
      sem.call ||
      sem.unknownEffects ||
      getFlagSemantics(line).controlFlow !== "fallthrough"
    )
      return;
    if (sem.writes.has(register)) return { line, index: at };
    if (cfg.predecessors[at].size !== 1) return;
    const previous = [...cfg.predecessors[at]][0];
    if (previous >= at || cfg.successors[previous].size !== 1) return;
    for (let i = previous + 1; i < at; i++)
      if (ctx.file.lines[i].mnemonic) return;
    at = previous;
  }
}

function loadedLabel(
  ctx: RuleContext,
  entry: number,
  register: Register,
  regions: ReturnType<typeof analyzeDataRegions>,
) {
  const definition = setupDefinition(ctx, entry, register);
  if (!definition) return;
  const { line, index } = definition;
  const name = semanticMnemonic(line);
  const source = line.operands?.[0];
  const dest = line.operands?.[1];
  if (
    dest?.type !== "address-register" ||
    normalizeRegister(dest.register) !== register
  )
    return;
  const expr =
    name === "lea" && source?.type === "absolute-address"
      ? source.address
      : name === "lea" && source?.type === "pc-relative"
        ? source.displacement
        : name === "movea" &&
            instructionSize(line) === "l" &&
            source?.type === "immediate"
          ? source.value
          : undefined;
  return expr ? regions.resolve(expr, index) : undefined;
}

export const bufferOverrun: Rule = {
  meta: {
    id: "suspicious/buffer-overrun",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag simple loops that access beyond data regions into code or past sections",
    tags: ["memory", "loops", "bounds"],
    docs: {
      note: "Checks a single postincrement MOVE/CLR/TST access per iteration over contiguous DC/DS/DCB data in any section. Internal labels are offsets, not boundaries; instructions and known section ends bound regions. Reopened sections continue their earlier data. End-of-file bounds require a known standalone source. Recognises excessive DBRA counts and inclusive BLS end-pointer tests. Requires unambiguous straight-line setup and loop flow; skips calls, macros, alternate entries, uncertain conditional assembly and complex pointer updates. Loop trips are calculated, not simulated.",
    },
  },
  checkFile(ctx) {
    const regions = analyzeDataRegions(ctx);
    const { cfg } = ctx.registers;
    for (const loop of findLoops(cfg)) {
      const members = loop.members;
      if (members.length > 256) continue;
      const head = members[0];
      const tail = members[members.length - 1];
      const branch = ctx.line(tail)!;
      const branchName = semanticMnemonic(branch);
      if (branchName !== "dbf" && branchName !== "bls") continue;
      const inside = new Set(members);
      const entries = members.flatMap((to) =>
        [...cfg.predecessors[to]]
          .filter((from) => !inside.has(from))
          .map((from) => ({ from, to })),
      );
      if (
        entries.length !== 1 ||
        entries[0].to !== head ||
        entries[0].from >= head
      )
        continue;
      if (
        loop.exits.length !== 1 ||
        loop.exits[0].from !== tail ||
        !cfg.successors[tail].has(head)
      )
        continue;
      if (
        members.some(
          (at, n) =>
            cfg.escapes[at] ||
            (at !== tail &&
              (cfg.successors[at].size !== 1 ||
                !cfg.successors[at].has(members[n + 1]))),
        )
      )
        continue;
      // Reject directives between executable nodes, including REPT/IIF/IF.
      if (
        ctx.file.lines
          .slice(entries[0].from, tail + 1)
          .some(
            (line) =>
              line.inlineCondition ||
              (line.mnemonic && line.mnemonic.type !== "instruction"),
          )
      )
        continue;
      if (
        members.some((at) => {
          const sem = getRegisterSemantics(ctx.line(at)!);
          return sem.call || sem.unknownEffects;
        })
      )
        continue;
      const accesses: { at: number; pointer: Register; bytes: number }[] = [];
      for (const at of members) {
        const line = ctx.line(at)!;
        if (!["move", "clr", "tst"].includes(semanticMnemonic(line) ?? ""))
          continue;
        const bytes = width(line);
        if (!bytes) continue;
        for (const op of line.operands ?? []) {
          if (
            op.type === "address-register-indirect-postinc" &&
            op.register.type === "address-register"
          ) {
            const pointer = normalizeRegister(op.register.register)!;
            if (pointer !== "a7") accesses.push({ at, pointer, bytes });
          }
        }
      }
      for (const access of accesses) {
        const { pointer, bytes, at } = access;
        if (accesses.filter((a) => a.pointer === pointer).length !== 1)
          continue;
        if (
          members.some(
            (i) =>
              i !== at &&
              getRegisterSemantics(ctx.line(i)!).writes.has(pointer),
          )
        )
          continue;
        // A MOVE such as MOVE.L (A0)+,A0 has another write to the pointer.
        if (
          ctx
            .line(at)!
            .operands?.some(
              (op) =>
                (op.type === "address-register" &&
                  normalizeRegister(op.register) === pointer) ||
                (op.type === "address-register-indirect-predec" &&
                  op.register.type === "address-register" &&
                  normalizeRegister(op.register.register) === pointer),
            )
        )
          continue;
        const buffer = loadedLabel(ctx, entries[0].from, pointer, regions);
        if (
          !buffer ||
          !buffer.region.boundary ||
          buffer.offset < 0 ||
          buffer.offset >= buffer.region.bytes
        )
          continue;
        const available = buffer.region.bytes - buffer.offset;
        let detail: string;
        if (branchName === "dbf") {
          const counter = branch.operands?.[0];
          if (counter?.type !== "data-register") continue;
          const reg = normalizeRegister(counter.register)!;
          if (
            members.some(
              (i) =>
                i !== tail &&
                getRegisterSemantics(ctx.line(i)!).writes.has(reg),
            )
          )
            continue;
          const value = ctx.registers.valueAfter(entries[0].from, reg);
          let count = value.kind === "constant" ? value.value : undefined;
          if (count === undefined) {
            const setup = setupDefinition(ctx, entries[0].from, reg)?.line;
            const source = setup?.operands?.[0];
            const dest = setup?.operands?.[1];
            if (
              setup &&
              semanticMnemonic(setup) === "move" &&
              (instructionSize(setup) === "w" ||
                instructionSize(setup) === "l") &&
              dest?.type === "data-register" &&
              normalizeRegister(dest.register) === reg &&
              source?.type === "immediate"
            ) {
              const evaluated = ctx.evaluate(source.value);
              if (evaluated.known) count = evaluated.value;
            }
          }
          if (count === undefined) continue;
          const trips = (count & 0xffff) + 1;
          if (trips * bytes <= available) continue;
          detail = `DBRA executes ${trips} iterations of ${bytes} bytes (${trips * bytes} bytes total)`;
        } else {
          const compareAt = members[members.length - 2];
          const compare = ctx.line(compareAt);
          if (
            !compare ||
            semanticMnemonic(compare) !== "cmpa" ||
            instructionSize(compare) !== "l" ||
            at >= compareAt
          )
            continue;
          const dest = compare.operands?.[1];
          if (
            dest?.type !== "address-register" ||
            normalizeRegister(dest.register) !== pointer
          )
            continue;
          const source = compare.operands?.[0];
          let end: typeof buffer | undefined;
          if (source?.type === "immediate")
            end = regions.resolve(source.value, compareAt);
          if (source?.type === "address-register") {
            const reg = normalizeRegister(source.register)!;
            if (
              members.some((i) =>
                getRegisterSemantics(ctx.line(i)!).writes.has(reg),
              )
            )
              continue;
            end = loadedLabel(ctx, entries[0].from, reg, regions);
          }
          if (
            !end ||
            end.region !== buffer.region ||
            end.offset !== buffer.region.bytes ||
            available % bytes !== 0
          )
            continue;
          detail =
            "BLS repeats when the pointer equals the end label, causing one extra access";
        }
        ctx.report({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence: "high",
          loc: branch.mnemonic!.loc,
          message: `Loop accesses ${buffer.region.boundary.kind === "code" ? "into code" : "beyond section " + buffer.region.section.label} from ${buffer.name} (${available} bytes available): ${detail}`,
          notes: [
            {
              message: `${available} bytes remain from this address to ${buffer.region.boundary.kind === "code" ? "the first instruction" : "the end of the section"}; internal data labels do not end the region.`,
              loc:
                ctx.line(buffer.index)!.label?.loc ??
                ctx.line(buffer.index)!.mnemonic!.loc,
            },
            {
              message: `This access advances ${pointer.toUpperCase()} by ${bytes} bytes each iteration.`,
              loc: ctx.line(at)!.mnemonic!.loc,
            },
          ],
          suggestion: {
            description:
              "Review the loop bound and data extent; crossing into code or another allocation may be intentional",
            applicability: "manual",
          },
        });
      }
    }
  },
};
