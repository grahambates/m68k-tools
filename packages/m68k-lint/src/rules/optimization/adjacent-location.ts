import type {
  AddressRegisterIndirectDisplacementNode,
  OperandNode,
} from "m68k-parser";
import type { RuleContext } from "../../core/context.js";
import { normalizeRegister } from "../../semantics/registers.js";

/**
 * A memory location an adjacent-store peephole can compare across two
 * instructions: a known absolute address, a known displacement off an address
 * register whose identity we can pin down (a concrete register, not one
 * arriving through a macro parameter), or a post-increment/pre-decrement
 * addressing mode on a concrete register. The last two carry no numeric value
 * because there is nothing to compute -- the CPU's own auto-increment is what
 * guarantees two uses of `(An)+` (or `-(An)`) in sequence are adjacent, not an
 * address either side evaluates.
 */
export type Location =
  | { kind: "absolute"; value: number }
  | { kind: "register-displacement"; register: string; value: number }
  | { kind: "postinc"; register: string }
  | { kind: "predec"; register: string };

function registerKey(
  register: AddressRegisterIndirectDisplacementNode["register"],
): string | undefined {
  return register.type === "address-register"
    ? normalizeRegister(register.register)
    : undefined;
}

/**
 * Read the location an operand writes to, when it is one of the forms these
 * peepholes fold: `$addr`, `disp(An)`, bare `(An)` (displacement 0 -- it costs
 * no extension word, which affects size/cycle accounting, not the address),
 * `(An)+`, or `-(An)`, always with a literal register. Symbol or
 * macro-parameter registers are excluded because there is no way to check two
 * of them name the same register without evaluating them as addresses, which
 * the parser does not offer.
 */
export function locationOf(
  ctx: RuleContext,
  op: OperandNode | undefined,
): Location | undefined {
  if (!op) return undefined;
  if (op.type === "absolute-address") {
    const result = ctx.evaluate(op.address);
    return result.known ? { kind: "absolute", value: result.value } : undefined;
  }
  if (op.type === "address-register-indirect-displacement") {
    const register = registerKey(op.register);
    if (!register) return undefined;
    const result = ctx.evaluate(op.displacement);
    return result.known
      ? { kind: "register-displacement", register, value: result.value }
      : undefined;
  }
  if (op.type === "address-register-indirect") {
    const register = registerKey(op.register);
    return register
      ? { kind: "register-displacement", register, value: 0 }
      : undefined;
  }
  if (op.type === "address-register-indirect-postinc") {
    const register = registerKey(op.register);
    return register ? { kind: "postinc", register } : undefined;
  }
  if (op.type === "address-register-indirect-predec") {
    const register = registerKey(op.register);
    return register ? { kind: "predec", register } : undefined;
  }
  return undefined;
}

/**
 * Whether `next` sits exactly `delta` bytes after `first`, in the same
 * location form. For `postinc`/`predec` there is no address to space by
 * `delta`: two uses of `(An)+` (or `-(An)`) on the same register are adjacent
 * by construction, so only the register is compared.
 *
 * One exception: byte-sized `-(a7)`/`(a7)+` always moves the stack pointer by
 * 2, not 1, to keep it word-aligned. Two chained byte accesses through A7
 * this way land two bytes apart, not one, so they are not actually adjacent
 * and must not be folded into a `.w` access -- unlike every other address
 * register, where a byte postinc/predec genuinely steps by 1.
 */
export function isAdjacentLocation(
  first: Location,
  next: Location,
  delta: number,
): boolean {
  if (first.kind !== next.kind) return false;
  if (
    (first.kind === "postinc" || first.kind === "predec") &&
    (next.kind === "postinc" || next.kind === "predec")
  ) {
    if (delta === 1 && first.register === "a7") return false;
    return first.register === next.register;
  }
  if (
    first.kind === "register-displacement" &&
    next.kind === "register-displacement"
  ) {
    if (first.register !== next.register) return false;
  }
  return (
    "value" in next && "value" in first && next.value === first.value + delta
  );
}
