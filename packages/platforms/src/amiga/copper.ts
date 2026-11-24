/**
 * Copper instructions, from the Hardware Reference Manual's chapter 2
 * ("Coprocessor Hardware"). Each is two words. MOVE has bit 0 of the first
 * word clear; WAIT and SKIP have it set, and are told apart by bit 0 of the
 * second.
 */

export type CopperInstruction =
  | {
      kind: "move";
      /** The register written, as an offset from $DFF000. */
      register: number;
      /** The value written. */
      value: number;
    }
  | {
      kind: "wait" | "skip";
      /** The vertical beam position compared, VP, 0-255. */
      vertical: number;
      /**
       * The horizontal beam position compared, HP, in colour clocks: even, as
       * its lowest bit is not compared, and at most $E2 on a real line.
       */
      horizontal: number;
      /**
       * Which vertical bits are compared: VP bit 7 always is, the rest as
       * the second word's VE bits say.
       */
      verticalMask: number;
      /** Which horizontal bits are compared, from the HE bits. */
      horizontalMask: number;
      /**
       * Whether the Copper also waits for the blitter to finish: the second
       * word's bit 15, blitter-finished-disable, is clear. It is normally set.
       */
      waitsForBlitter: boolean;
    };

/** The two words of a Copper instruction, read. */
export function decodeCopperInstruction(
  first: number,
  second: number,
): CopperInstruction {
  const ir1 = first & 0xffff;
  const ir2 = second & 0xffff;
  if (!(ir1 & 1)) return { kind: "move", register: ir1 & 0x1fe, value: ir2 };
  return {
    kind: ir2 & 1 ? "skip" : "wait",
    vertical: ir1 >> 8,
    horizontal: ir1 & 0xfe,
    verticalMask: 0x80 | ((ir2 >> 8) & 0x7f),
    horizontalMask: ir2 & 0xfe,
    waitsForBlitter: !(ir2 & 0x8000),
  };
}

/**
 * Whether a WAIT can never end: line $FF with a horizontal position past the
 * last, $E2, as in the usual end of a Copper list, $FFFF,$FFFE.
 */
export function isCopperEnd(instruction: CopperInstruction): boolean {
  return (
    instruction.kind === "wait" &&
    instruction.vertical === 0xff &&
    instruction.verticalMask === 0xff &&
    instruction.horizontal > 0xe2 &&
    (instruction.horizontalMask & instruction.horizontal) > 0xe2
  );
}

/**
 * The lowest register a Copper MOVE can write: $20, or $10 with COPCON's
 * danger bit set. Below $10 it can write nothing.
 */
export const COPPER_SAFE_REGISTER = 0x20;
export const COPPER_DANGER_REGISTER = 0x10;
