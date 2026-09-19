import { isSectionDirective, type ParsedFile } from "m68k-parser";
import { getFlagSemantics } from "../semantics/flags.js";
import { isExecutableLine, isMacroInvocation } from "../util/ast.js";
import { isBlockBoundary, scanBlocks } from "./blocks.js";
import { buildControlFlowGraph } from "./cfg.js";
import type { LocalLabelScopes } from "./local-label-scopes.js";

/**
 * Directives that start code somewhere the flow above does not lead: a new
 * section, or a new origin or offset.
 */
const startsElsewhere = (directive: string) =>
  isSectionDirective(directive) ||
  directive === "org" ||
  directive === "offset";

/**
 * Instructions that nothing can reach.
 *
 * Deliberately narrow: an instruction is only unreachable when no path leads
 * to it *and* nothing outside this file's flow could plausibly enter it. So
 * every place control might arrive from something this analysis cannot see is
 * a starting point rather than a finding:
 *
 * - the first instruction, and the first after a section or block directive
 *   (an IF arm, a REPT body, a new section);
 * - any label except a local one that nothing in its routine refers to. A
 *   global label may be called from another file or a vector table, and a
 *   referenced local label is a branch target even if the branch is itself
 *   dead;
 * - the code straight after a computed jump, and any unbroken run of branches
 *   after that. `jmp table(pc,d0.w)` followed by unlabelled `bra.w` entries is
 *   a jump table, and those entries are reached only by the computed jump;
 * - macro invocations, which stand in for code this cannot see.
 *
 * Reachability then follows the control-flow graph from those. What remains is
 * code after a `bra`, `rts` or similar with nothing pointing at it, which is
 * usually left over from an edit.
 */
export function findUnreachableLines(
  file: ParsedFile,
  scopes: LocalLabelScopes,
): number[] {
  const blocks = scanBlocks(file);
  const cfg = buildControlFlowGraph(file);
  const executable: number[] = [];
  const seeds: number[] = [];

  let previous: number | undefined;
  let pendingLabels: { index: number; name: string }[] = [];
  let boundary = false;
  // Inside a run of branches following a computed jump: an inline jump table.
  let inTable = false;

  file.lines.forEach((line, index) => {
    // A macro body is not code at this point in the file.
    if (blocks.region[index] !== 0) return;

    const directive =
      line.mnemonic?.type === "directive"
        ? line.mnemonic.directive.toLowerCase()
        : undefined;
    if (isBlockBoundary(line) || (directive && startsElsewhere(directive)))
      boundary = true;
    if (line.label) pendingLabels.push({ index, name: line.label.label });
    if (!isExecutableLine(line)) return;

    executable.push(index);

    const enteredElsewhere = pendingLabels.some(({ index: at, name }) => {
      const label = file.lines[at]?.label;
      if (!label) return true;
      if (label.scope !== "local" || label.interpolated) return true;
      return scopes.referenced.has(scopes.keyOf(at, name));
    });

    const afterComputedJump =
      previous !== undefined &&
      cfg.escapes[previous] &&
      getFlagSemantics(file.lines[previous]).controlFlow === "dynamic-jump";
    const isBranch =
      line.mnemonic?.type === "instruction" &&
      getFlagSemantics(line).controlFlow === "unconditional-branch";
    const tableEntry = afterComputedJump || (inTable && isBranch);
    inTable = tableEntry && isBranch;

    if (
      previous === undefined ||
      boundary ||
      enteredElsewhere ||
      tableEntry ||
      isMacroInvocation(line)
    )
      seeds.push(index);

    previous = index;
    pendingLabels = [];
    boundary = false;
  });

  const reached = new Set<number>();
  const stack = [...seeds];
  while (stack.length) {
    const at = stack.pop()!;
    if (reached.has(at)) continue;
    reached.add(at);
    for (const next of cfg.successors[at]) stack.push(next);
  }

  return executable.filter(
    (index) =>
      !reached.has(index) && file.lines[index].mnemonic?.type === "instruction",
  );
}
