import {
  conditionalComparison,
  isUnconditionalAlternative,
  evaluateConstant,
  parseExpression,
  symbolKey,
  type Block,
  type BlockStructure,
  type ExpressionNode,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";
import {
  DiagnosticSeverity,
  DiagnosticTag,
  type Diagnostic,
} from "vscode-languageserver";

import { escapeSequencesOn, symbolsCaseSensitive, type Config } from "./config";

interface KnownValue {
  /**
   * The value, or how to work it out from the symbols known where it is read.
   * vasm resolves an `equ` that refers to a symbol not yet defined once that
   * symbol is, as it does an offset counted with one, so `A equ B*2` above
   * `B equ 3` is 6 from there on.
   */
  value: number | Pending;
  immutable: boolean;
}

type Pending = (values: Values) => number | undefined;

/**
 * Symbols known at a point in the walk.
 *
 * A conditional's arms each start from the same values. Rather than copy every
 * symbol for each arm, an arm runs on these values while a journal records the
 * first earlier entry of each name it changes; the arm's changes are read from
 * the journal and then undone. That keeps a conditional's cost to what it
 * changes, where copying made a file of many conditionals and many symbols
 * quadratic. Mutable names are kept apart for the same reason, as includes and
 * macro calls forget them.
 */
class Values extends Map<string, KnownValue> {
  private readonly mutable = new Set<string>();
  private readonly journals: Map<string, KnownValue | undefined>[] = [];

  constructor(entries?: Iterable<readonly [string, KnownValue]>) {
    // Entries are added here rather than by Map, whose constructor would call
    // `set` before the fields above exist.
    super();
    for (const [name, entry] of entries ?? []) this.set(name, entry);
  }

  private record(name: string) {
    const journal = this.journals.at(-1);
    if (journal && !journal.has(name)) journal.set(name, super.get(name));
  }

  override set(name: string, entry: KnownValue): this {
    this.record(name);
    if (entry.immutable) this.mutable.delete(name);
    else this.mutable.add(name);
    return super.set(name, entry);
  }

  override delete(name: string): boolean {
    if (!super.has(name)) return false;
    this.record(name);
    this.mutable.delete(name);
    return super.delete(name);
  }

  override clear(): void {
    for (const name of [...this.keys()]) this.delete(name);
  }

  /** Includes and macro calls can change SET values, but not constants. */
  forgetMutable() {
    for (const name of [...this.mutable]) this.delete(name);
  }

  /** Start recording changes, for `undo` to take back. */
  begin() {
    this.journals.push(new Map());
  }

  /**
   * Take back the changes since `begin`, returning what they left: each
   * changed name's entry then, or undefined where it was removed.
   */
  undo(): Map<string, KnownValue | undefined> {
    const journal = this.journals.pop()!;
    const changes = new Map<string, KnownValue | undefined>();
    for (const [name, earlier] of journal) {
      changes.set(name, super.get(name));
      if (earlier === undefined) this.delete(name);
      else this.set(name, earlier);
    }
    return changes;
  }
}

/** Directives whose operands vasm can resolve from later definitions. */
const FINAL_PASS_DIRECTIVES = new Set([
  "equ",
  "=",
  "rs",
  "so",
  "fo",
  "dc",
  "dcb",
  "ds",
  "blk",
]);

/** Definitions a final-pass line can see from before they are made. */
const FORWARD_DEFINITIONS = new Set(["equ", "=", "rs", "so", "fo"]);

/** The offset counters, and the directives that count with or set them. */
const OFFSET_COUNTERS: Readonly<Record<string, string>> = {
  rs: "__RS",
  so: "__SO",
  fo: "__FO",
};
const OFFSET_RESETS: Readonly<Record<string, string>> = {
  rsreset: "__RS",
  clrso: "__SO",
  clrfo: "__FO",
};
const OFFSET_SETS: Readonly<Record<string, string>> = {
  rsset: "__RS",
  setso: "__SO",
  setfo: "__FO",
};

const SIZE_BYTES: Readonly<Record<string, number>> = {
  b: 1,
  w: 2,
  l: 4,
  q: 8,
  s: 4,
  d: 8,
  x: 12,
  p: 12,
};

export interface AssemblyConstants {
  constants: ReadonlyMap<string, number>;
  defaults: ReadonlyMap<string, ExpressionNode>;
  guard?: string;
}

const directive = ({ mnemonic }: ParsedLine) =>
  mnemonic?.type === "directive" ? mnemonic.directive : undefined;

const expression = ({ operands }: ParsedLine): ExpressionNode | undefined => {
  const operand = operands?.length === 1 ? operands[0] : undefined;
  return operand?.type === "value"
    ? operand.value
    : operand?.type === "string-literal"
      ? operand
      : undefined;
};

export function analyzeConditionals(
  parsed: ParsedFile,
  { blocks, errors }: BlockStructure,
  config: Config,
  includeConstants?: (line: number) => AssemblyConstants | undefined,
  reportDiagnostics = true,
  mayDefineEarlier?: (
    line: number,
    name: string,
    fromCurrentInclude?: boolean,
  ) => boolean,
  targetLine?: number,
  /**
   * Where the offset counters start, which for vasm is 0. Leave it out for a
   * file that may be included, where they hold whatever the includer left.
   */
  offsetCountersStart?: number,
) {
  const values = new Values();
  let atLine: Values | undefined;
  let captureTarget = targetLine !== undefined;
  const defaults = new Map<string, ExpressionNode>();
  if (errors.length)
    return {
      diagnostics: [],
      constants: new Map<string, number>(),
      defaults,
      evaluateAtLine: undefined,
    };
  const { lines } = parsed;
  const invalid = new Set(parsed.errors.map(({ loc }) => (loc.line ?? 0) - 1));
  const diagnostics: Diagnostic[] = [];
  const caseSensitive = symbolsCaseSensitive(config);
  const options = { escapeSequences: escapeSequencesOn(config) };
  const key = (name: string) => symbolKey(name, caseSensitive);
  // Pending values being worked out, so a definition that refers back to
  // itself, directly or through others, is unknown rather than endless.
  const resolving = new Set<Pending>();
  const resolve = (
    entry: KnownValue | undefined,
    values: Values,
  ): number | undefined => {
    if (!entry) return;
    const pending = entry.value;
    if (typeof pending === "number") return pending;
    if (resolving.has(pending)) return;
    resolving.add(pending);
    try {
      return pending(values);
    } finally {
      resolving.delete(pending);
    }
  };
  const evaluate = (expr: ExpressionNode | undefined, values: Values) => {
    if (!expr) return;
    const result = evaluateConstant(
      expr,
      (name) => resolve(values.get(key(name)), values),
      options,
    );
    return result.known && Number.isInteger(result.value)
      ? result.value
      : undefined;
  };
  /** A value known now, or else one to work out when it is read. */
  const settle = (pending: Pending, values: Values): number | Pending =>
    pending(values) ?? pending;

  // vasm aligns offsets to even under -devpac or -align, for any size but a
  // byte. Measured against vasm 2.0f: RS and SO round the counter up before
  // the label takes it; FO subtracts first and then takes (x - 1) & ~1, so
  // even a counter that is already even moves down by two (SETFO -4 then
  // FO.L 1 is -10).
  const alignOffsets = config.vasm.args.some(
    (arg) => arg === "-devpac" || arg === "-align",
  );
  if (offsetCountersStart !== undefined) {
    for (const counter of Object.values(OFFSET_COUNTERS)) {
      values.set(key(counter), {
        value: offsetCountersStart,
        immutable: false,
      });
    }
  }

  const commandLineDefinitions = new Set<string>();
  if (reportDiagnostics || targetLine !== undefined) {
    const args = config.vasm.args;
    for (let i = 0; i < args.length; i++) {
      if (!args[i].startsWith("-D")) continue;
      const arg = args[i] === "-D" ? args[++i] : args[i].slice(2);
      const definition = arg && /^([a-z_][\w.$]*)(?:=(.*))?$/i.exec(arg);
      if (!definition) continue;
      const name = key(definition[1]);
      commandLineDefinitions.add(name);
      const parsed = parseExpression(definition[2] ?? "1");
      const value = parsed.errors.length
        ? undefined
        : evaluate(parsed.value, values);
      if (value !== undefined) values.set(name, { value, immutable: true });
    }
  }

  // A conventional header guard encloses the entire file and defines its
  // own marker before declaring any constants.
  const outer = blocks.length === 1 ? blocks[0] : undefined;
  let headerGuard: string | undefined;
  if (
    !reportDiagnostics &&
    targetLine === undefined &&
    outer?.kind === "conditional" &&
    outer.end !== undefined &&
    !outer.alternatives.length &&
    directive(lines[outer.start]) === "ifnd" &&
    !invalid.has(outer.start) &&
    !invalid.has(outer.start + 1) &&
    [...lines.slice(0, outer.start), ...lines.slice(outer.end + 1)].every(
      (line) => !line.mnemonic && !line.label,
    )
  ) {
    const guard = expression(lines[outer.start]);
    const marker = lines[outer.start + 1];
    if (
      guard?.type === "symbol" &&
      marker?.label &&
      key(guard.name) === key(marker.label.label) &&
      ["set", "equ", "="].includes(directive(marker) ?? "") &&
      evaluate(expression(marker), values) !== undefined
    ) {
      headerGuard = guard.name;
    }
  }

  function dim(
    start: Diagnostic["range"]["start"],
    end: Diagnostic["range"]["end"],
  ) {
    diagnostics.push({
      range: { start, end },
      message: "Inactive conditional assembly",
      severity: DiagnosticSeverity.Hint,
      tags: [DiagnosticTag.Unnecessary],
      source: "m68k",
      code: "inactive-conditional",
    });
  }

  function condition(index: number, values: Values): boolean | undefined {
    if (invalid.has(index)) return;
    const line = lines[index];
    const name = directive(line);
    if (isUnconditionalAlternative(name)) return true;
    const expr = expression(line);
    if ((name === "ifd" || name === "ifnd") && expr?.type === "symbol") {
      if (
        values.has(key(expr.name)) ||
        commandLineDefinitions.has(key(expr.name))
      )
        return name === "ifd";
      return;
    }
    const test = name && conditionalComparison(name);
    if (!test) return;
    const value = evaluate(expr, values);
    return value === undefined ? undefined : test(value);
  }

  function applyLine(index: number, values: Values, report: boolean) {
    const line = lines[index];
    const name = directive(line);
    const conditional =
      line.inlineCondition && !invalid.has(index)
        ? evaluate(line.inlineCondition, values)
        : undefined;
    if (conditional === 0) {
      if (report && line.mnemonic) {
        dim(
          { line: index, character: line.mnemonic.loc.start },
          {
            line: index,
            character:
              line.comment?.loc.end ??
              line.operands?.at(-1)?.loc.end ??
              line.mnemonic.loc.end,
          },
        );
      }
      return;
    }

    // Includes and macro expansions can change SET variables, but vasm
    // rejects redefinitions of EQU and = constants.
    if (
      name === "include" ||
      line.mnemonic?.type === "macro" ||
      line.mnemonic?.type === "macro-parameter"
    ) {
      values.forgetMutable();
      if (
        name === "include" &&
        (!line.inlineCondition || conditional !== undefined)
      ) {
        const included = includeConstants?.(index);
        if (included?.guard) {
          const guard = key(included.guard);
          if (
            values.has(guard) ||
            commandLineDefinitions.has(guard) ||
            mayDefineEarlier?.(index, included.guard, true)
          )
            return;
        }
        for (const [name, value] of included?.constants ?? []) {
          if (!values.has(name)) values.set(name, { value, immutable: true });
        }
        for (const [name, expr] of included?.defaults ?? []) {
          const symbol = key(name);
          if (
            values.has(symbol) ||
            commandLineDefinitions.has(symbol) ||
            mayDefineEarlier?.(index, name)
          )
            continue;
          const value = evaluate(expr, values);
          if (value !== undefined)
            values.set(symbol, { value, immutable: true });
        }
      }
      return;
    }
    const usable =
      !invalid.has(index) &&
      (!line.inlineCondition || conditional !== undefined);
    if (name && (OFFSET_RESETS[name] || OFFSET_SETS[name])) {
      const counter = key(OFFSET_RESETS[name] ?? OFFSET_SETS[name]);
      // vasm requires a constant here, so it is never left pending.
      const value = !usable
        ? undefined
        : OFFSET_RESETS[name]
          ? 0
          : evaluate(expression(line), values);
      if (value === undefined) values.delete(counter);
      else values.set(counter, { value, immutable: false });
      return;
    }
    if (name && OFFSET_COUNTERS[name]) {
      applyOffset(line, name, values, usable);
      return;
    }

    if (line.label?.scope !== "global") return;
    const symbol = key(line.label.label);
    const expr = expression(line);
    if ((name === "equ" || name === "=") && usable && expr) {
      values.set(symbol, {
        value: settle((current) => evaluate(expr, current), values),
        immutable: true,
      });
      return;
    }
    const value = name === "set" && usable ? evaluate(expr, values) : undefined;
    if (value === undefined) values.delete(symbol);
    else values.set(symbol, { value, immutable: false });
  }

  /**
   * `label RS.size count`: the label takes the counter, which then moves on by
   * size × count; FO moves the counter down first and the label takes that.
   */
  function applyOffset(
    line: ParsedLine,
    name: string,
    values: Values,
    usable: boolean,
  ) {
    const counter = key(OFFSET_COUNTERS[name]);
    const qualifier = line.qualifier;
    const bytes = !qualifier
      ? SIZE_BYTES.w
      : qualifier.type === "size"
        ? SIZE_BYTES[qualifier.size.toLowerCase()]
        : undefined;
    const count = expression(line);
    const base = values.get(counter);
    const align = alignOffsets && bytes !== undefined && bytes > 1;
    const step: Pending = (current) => {
      const start = resolve(base, current);
      const n = evaluate(count, current);
      return start === undefined || n === undefined || bytes === undefined
        ? undefined
        : start;
    };
    let label: Pending;
    let next: Pending;
    if (name === "fo") {
      next = (current) => {
        const start = step(current);
        if (start === undefined) return;
        const moved = start - bytes! * evaluate(count, current)!;
        return align ? (moved - 1) & ~1 : moved;
      };
      label = next;
    } else {
      label = (current) => {
        const start = resolve(base, current);
        if (start === undefined) return;
        return align ? (start + 1) & ~1 : start;
      };
      next = (current) => {
        const start = step(current) === undefined ? undefined : label(current);
        return start === undefined
          ? undefined
          : start + bytes! * evaluate(count, current)!;
      };
    }
    if (usable && bytes !== undefined && count) {
      values.set(counter, { value: settle(next, values), immutable: false });
    } else {
      values.delete(counter);
    }
    if (line.label?.scope === "global") {
      const symbol = key(line.label.label);
      if (usable) {
        values.set(symbol, { value: settle(label, values), immutable: true });
      } else {
        values.delete(symbol);
      }
    }
  }

  function walk(
    start: number,
    end: number,
    children: Block[],
    values: Values,
    report: boolean,
  ) {
    let next = 0;
    for (let index = start; index < end; index++) {
      if (captureTarget && targetLine !== undefined && index > targetLine)
        return;
      if (captureTarget && index === targetLine) atLine = new Values(values);
      const block = children[next];
      if (block?.start === index && block.end !== undefined) {
        if (block.kind === "conditional")
          walkConditional(block, values, report);
        // A repeat may change constants with each iteration. Macro definitions
        // do not execute until invoked and cannot inherit today's values.
        if (
          block.kind !== "conditional" &&
          captureTarget &&
          targetLine !== undefined &&
          targetLine > block.start &&
          targetLine < block.end
        ) {
          atLine = new Values(values);
          atLine.forgetMutable();
          return;
        }
        if (block.kind === "repeat") values.forgetMutable();
        index = block.end;
        next++;
      } else if (
        directive(lines[index]) === "end" &&
        !lines[index].inlineCondition
      ) {
        return;
      } else {
        applyLine(index, values, report);
      }
    }
  }

  function walkConditional(block: Block, values: Values, report: boolean) {
    const arms = [block.start, ...block.alternatives, block.end!];
    // What each arm that may assemble changes, from the values before it.
    const outcomes: Map<string, KnownValue | undefined>[] = [];
    let remaining: boolean | undefined = true;
    for (let i = 0; i < arms.length - 1; i++) {
      const head = arms[i];
      if (captureTarget && head === targetLine) atLine = new Values(values);
      const end = arms[i + 1];
      let selected = remaining === false ? false : condition(head, values);
      if (headerGuard && block === outer) selected = true;
      // Index simple, file-level defaults for resolution in the includer's
      // assembly context, where preceding includes and -D flags are known.
      if (
        selected === undefined &&
        i === 0 &&
        block.alternatives.length === 0 &&
        end === head + 2 &&
        directive(lines[head]) === "ifnd" &&
        !invalid.has(head)
      ) {
        const guard = expression(lines[head]);
        const assignment = lines[head + 1];
        const assignmentKind = directive(assignment);
        const expr = expression(assignment);
        if (
          guard?.type === "symbol" &&
          assignment.label &&
          expr &&
          !invalid.has(head + 1) &&
          key(assignment.label.label) === key(guard.name) &&
          (assignmentKind === "=" || assignmentKind === "equ")
        ) {
          if (mayDefineEarlier && !mayDefineEarlier(head, guard.name))
            selected = true;
          if (
            !reportDiagnostics &&
            targetLine === undefined &&
            blocks.includes(block) &&
            !lines
              .slice(0, head)
              .some(
                (line) =>
                  directive(line) === "include" ||
                  line.mnemonic?.type === "macro" ||
                  line.mnemonic?.type === "macro-parameter" ||
                  (line.label && key(line.label.label) === key(guard.name)),
              )
          ) {
            defaults.set(guard.name, expr);
          }
        }
      }
      if (selected === false) {
        if (report && head + 1 < end)
          dim({ line: head + 1, character: 0 }, { line: end, character: 0 });
      } else {
        values.begin();
        walk(
          head + 1,
          end,
          block.children.filter(
            (child) => child.start > head && child.start < end,
          ),
          values,
          report && remaining === true && selected === true,
        );
        outcomes.push(values.undo());
      }
      if (selected === true) remaining = false;
      else if (selected === undefined) remaining = undefined;
    }
    // The path that skips every arm changes nothing.
    if (remaining !== false) outcomes.push(new Map());

    // A value remains usable after the conditional if every possible path
    // gives it the same value, including the path that skips all arms. Only
    // names some arm changed can differ.
    const changed = new Set(outcomes.flatMap((outcome) => [...outcome.keys()]));
    for (const name of changed) {
      const before = values.get(name);
      const results = outcomes.map((outcome) =>
        outcome.has(name) ? outcome.get(name) : before,
      );
      const [first] = results;
      if (first && results.every((result) => result?.value === first.value)) {
        values.set(name, {
          value: first.value,
          immutable: results.every((result) => result?.immutable),
        });
      } else {
        values.delete(name);
      }
    }
  }

  // Lines vasm resolves once the whole source is read, which can use what is
  // defined after them: instructions, data, and the definitions of constants
  // and offsets. Conditions and SET are decided where they stand.
  const target = targetLine === undefined ? undefined : lines[targetLine];
  const targetDirective = target && directive(target);
  const initialValues =
    target &&
    !target.inlineCondition &&
    (target.mnemonic?.type === "instruction" ||
      (targetDirective !== undefined &&
        FINAL_PASS_DIRECTIVES.has(targetDirective)))
      ? new Values(values)
      : undefined;
  let forwardValues: Values | undefined;

  function evaluateOperand(
    expression: ExpressionNode,
    snapshot: Values,
    line: number,
  ) {
    const value = evaluate(expression, snapshot);
    if (value !== undefined || !initialValues) return value;
    if (!forwardValues) {
      // Such a line can refer to a constant or offset defined later, or, for
      // an offset's own label, on the line itself.
      const later = new Values(initialValues);
      captureTarget = false;
      walk(0, lines.length, blocks, later, false);
      const definitions = definitionCounts();
      const candidates = new Set<string>();
      for (const [index, source] of lines.entries()) {
        if (source.label?.scope !== "global") continue;
        const name = key(source.label.label);
        if (
          index >= line &&
          !source.inlineCondition &&
          FORWARD_DEFINITIONS.has(directive(source) ?? "")
        ) {
          candidates.add(name);
        }
      }
      forwardValues = new Values(snapshot);
      for (const name of candidates) {
        const entry = later.get(name);
        if (
          entry?.immutable &&
          definitions.get(name) === 1 &&
          !forwardValues.has(name)
        ) {
          forwardValues.set(name, entry);
        }
      }
    }
    return evaluate(expression, forwardValues);
  }

  /** How many lines of the file define each name. */
  function definitionCounts() {
    const counts = new Map<string, number>();
    for (const source of lines) {
      if (source.label?.scope !== "global") continue;
      const name = key(source.label.label);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }

  walk(0, lines.length, blocks, values, reportDiagnostics);

  const constants = new Map<string, number>();
  for (const [name, entry] of values) {
    const value = entry.immutable ? resolve(entry, values) : undefined;
    if (value !== undefined) constants.set(name, value);
  }
  const snapshot = atLine;
  return {
    diagnostics,
    constants,
    defaults,
    guard: headerGuard,
    evaluateAtLine:
      snapshot && targetLine !== undefined && !invalid.has(targetLine)
        ? (expression: ExpressionNode) =>
            evaluateOperand(expression, snapshot, targetLine)
        : undefined,
  };
}
