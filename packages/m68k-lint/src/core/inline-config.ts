import type { Diagnostic } from "./diagnostic.js";

type DirectiveAction =
  "disable" | "enable" | "disable-next-line" | "disable-line";

interface Directive {
  action: DirectiveAction;
  /** null means all rules. */
  rules: Set<string> | null;
}

interface GlobalSuppressionState {
  all: boolean;
  /** Disabled rules while `all` is false. */
  rules: Set<string>;
  /** Explicitly enabled rules while `all` is true. */
  exceptions: Set<string>;
}

interface LineSuppression {
  all: boolean;
  rules: Set<string>;
}

function commentText(line: string): string | undefined {
  // A `*` in column 0 starts a full-line comment in the traditional 68k
  // assemblers (Devpac, AsmOne, vasm), which is how most Amiga sources spell
  // one. Anywhere else `*` is multiplication or the current-PC symbol, so the
  // column matters.
  if (line.startsWith("*")) return line.slice(1);

  let quote: "'" | '"' | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ";") return line.slice(i + 1);
  }
  return undefined;
}

function parseDirective(line: string): Directive | undefined {
  const comment = commentText(line);
  if (comment === undefined) return undefined;
  const match = comment.match(
    /^\s*m68k-lint-(disable-next-line|disable-line|disable|enable)\b(.*)$/i,
  );
  if (!match) return undefined;
  const action = match[1].toLowerCase() as DirectiveAction;
  const remainder = match[2].replace(/\s+--\s+.*$/, "").trim();
  if (!remainder) return { action, rules: null };
  const rules = new Set(
    remainder
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return { action, rules: rules.size ? rules : null };
}

function cloneLineSuppression(value?: LineSuppression): LineSuppression {
  return value
    ? { all: value.all, rules: new Set(value.rules) }
    : { all: false, rules: new Set() };
}

function addLineSuppression(
  target: LineSuppression,
  rules: Set<string> | null,
): void {
  if (rules === null) {
    target.all = true;
    return;
  }
  for (const rule of rules) target.rules.add(rule);
}

function applyGlobalDirective(
  state: GlobalSuppressionState,
  directive: Directive,
): void {
  const { action, rules } = directive;
  if (action !== "disable" && action !== "enable") return;
  if (action === "disable") {
    if (rules === null) {
      state.all = true;
      state.rules.clear();
      state.exceptions.clear();
      return;
    }
    if (state.all) {
      for (const rule of rules) state.exceptions.delete(rule);
    } else {
      for (const rule of rules) state.rules.add(rule);
    }
    return;
  }

  if (rules === null) {
    state.all = false;
    state.rules.clear();
    state.exceptions.clear();
    return;
  }
  if (state.all) {
    for (const rule of rules) state.exceptions.add(rule);
  } else {
    for (const rule of rules) state.rules.delete(rule);
  }
}

function isGloballyDisabled(
  state: GlobalSuppressionState,
  ruleId: string,
): boolean {
  return state.all ? !state.exceptions.has(ruleId) : state.rules.has(ruleId);
}

/**
 * Build a 1-based line predicate for ESLint-style m68k-lint comment directives.
 * Directives are deliberately parsed from raw source comments rather than the AST,
 * so suppression remains independent of assembler/parser comment nodes.
 */
export function createInlineSuppression(
  source: string,
): (diagnostic: Diagnostic) => boolean {
  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const state: GlobalSuppressionState = {
    all: false,
    rules: new Set(),
    exceptions: new Set(),
  };
  const globalByLine = new Map<number, GlobalSuppressionState>();
  const localByLine = new Map<number, LineSuppression>();
  let pendingNext: LineSuppression | undefined;

  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    if (pendingNext) {
      localByLine.set(lineNo, cloneLineSuppression(pendingNext));
      pendingNext = undefined;
    }

    const directive = parseDirective(lines[index]);
    if (directive) {
      if (directive.action === "disable" || directive.action === "enable") {
        applyGlobalDirective(state, directive);
      } else if (directive.action === "disable-line") {
        const local = cloneLineSuppression(localByLine.get(lineNo));
        addLineSuppression(local, directive.rules);
        localByLine.set(lineNo, local);
      } else {
        pendingNext = { all: false, rules: new Set() };
        addLineSuppression(pendingNext, directive.rules);
      }
    }

    globalByLine.set(lineNo, {
      all: state.all,
      rules: new Set(state.rules),
      exceptions: new Set(state.exceptions),
    });
  }

  return (diagnostic: Diagnostic): boolean => {
    const line = diagnostic.loc.line ?? 1;
    const global = globalByLine.get(line);
    if (global && isGloballyDisabled(global, diagnostic.ruleId)) return true;
    const local = localByLine.get(line);
    return Boolean(local && (local.all || local.rules.has(diagnostic.ruleId)));
  };
}
