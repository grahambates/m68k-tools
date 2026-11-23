import {
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
  value: number;
  immutable: boolean;
}

type Values = Map<string, KnownValue>;

export interface AssemblyConstants {
  constants: ReadonlyMap<string, number>;
  defaults: ReadonlyMap<string, ExpressionNode>;
  guard?: string;
}

function forgetMutableValues(values: Values) {
  for (const [name, entry] of values) {
    if (!entry.immutable) values.delete(name);
  }
}

const numericTests: Record<string, (value: number) => boolean> = {
  if: (value) => value !== 0,
  ifne: (value) => value !== 0,
  ifeq: (value) => value === 0,
  ifgt: (value) => value > 0,
  ifge: (value) => value >= 0,
  iflt: (value) => value < 0,
  ifle: (value) => value <= 0,
  elif: (value) => value !== 0,
};

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
) {
  const values: Values = new Map();
  let atLine: Values | undefined;
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
  const evaluate = (expr: ExpressionNode | undefined, values: Values) => {
    if (!expr) return;
    const result = evaluateConstant(
      expr,
      (name) => values.get(key(name))?.value,
      options,
    );
    return result.known && Number.isInteger(result.value)
      ? result.value
      : undefined;
  };

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
    if (name === "else" || name === "elseif") return true;
    const expr = expression(line);
    if ((name === "ifd" || name === "ifnd") && expr?.type === "symbol") {
      if (
        values.has(key(expr.name)) ||
        commandLineDefinitions.has(key(expr.name))
      )
        return name === "ifd";
      return;
    }
    const test = name && numericTests[name];
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
      forgetMutableValues(values);
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
    if (line.label?.scope !== "global") return;
    const symbol = key(line.label.label);
    const value =
      (name === "equ" || name === "=" || name === "set") &&
      !invalid.has(index) &&
      (!line.inlineCondition || conditional !== undefined)
        ? evaluate(expression(line), values)
        : undefined;
    if (value === undefined) values.delete(symbol);
    else
      values.set(symbol, { value, immutable: name === "equ" || name === "=" });
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
      if (targetLine !== undefined && index > targetLine) return;
      if (index === targetLine) atLine = new Map(values);
      const block = children[next];
      if (block?.start === index && block.end !== undefined) {
        if (block.kind === "conditional")
          walkConditional(block, values, report);
        // A repeat may change constants with each iteration. Macro definitions
        // do not execute until invoked and cannot inherit today's values.
        if (
          block.kind !== "conditional" &&
          targetLine !== undefined &&
          targetLine > block.start &&
          targetLine < block.end
        ) {
          atLine = new Map(values);
          forgetMutableValues(atLine);
          return;
        }
        if (block.kind === "repeat") forgetMutableValues(values);
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
    const outcomes: Values[] = [];
    let remaining: boolean | undefined = true;
    for (let i = 0; i < arms.length - 1; i++) {
      const head = arms[i];
      if (head === targetLine) atLine = new Map(values);
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
        const branch = new Map(values);
        walk(
          head + 1,
          end,
          block.children.filter(
            (child) => child.start > head && child.start < end,
          ),
          branch,
          report && remaining === true && selected === true,
        );
        outcomes.push(branch);
      }
      if (selected === true) remaining = false;
      else if (selected === undefined) remaining = undefined;
    }
    if (remaining !== false) outcomes.push(new Map(values));

    // A value remains usable after the conditional if every possible path
    // gives it the same value, including the path that skips all arms.
    values.clear();
    for (const [name, entry] of outcomes[0] ?? []) {
      if (
        outcomes.every((outcome) => outcome.get(name)?.value === entry.value)
      ) {
        values.set(name, {
          value: entry.value,
          immutable: outcomes.every((outcome) => outcome.get(name)?.immutable),
        });
      }
    }
  }

  walk(0, lines.length, blocks, values, reportDiagnostics);
  const constants = new Map<string, number>();
  for (const [name, entry] of values) {
    if (entry.immutable) constants.set(name, entry.value);
  }
  const snapshot = atLine;
  return {
    diagnostics,
    constants,
    defaults,
    guard: headerGuard,
    evaluateAtLine:
      snapshot && targetLine !== undefined && !invalid.has(targetLine)
        ? (expression: ExpressionNode) => evaluate(expression, snapshot)
        : undefined,
  };
}
