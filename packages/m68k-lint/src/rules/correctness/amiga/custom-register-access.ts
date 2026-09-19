import type { ExpressionNode, OperandNode, ParsedLine } from "m68k-parser";
import type { Rule } from "../../../core/rule.js";
import type { RuleContext } from "../../../core/context.js";
import { canonicalMnemonic } from "../../../semantics/mnemonics.js";
import { operand } from "../../../util/ast.js";
import { evaluateConstant } from "../../../analysis/constants.js";
import {
  getRegisterSemantics,
  normalizeRegister,
  type Register,
} from "../../../semantics/registers.js";
import { semanticMnemonic } from "../../../semantics/mnemonics.js";
import { hex } from "../../../util/format.js";

type Access = "read" | "write" | "readwrite";
type RegisterAccess = "read-only" | "write-only";

interface CustomRegister {
  name: string;
  access: RegisterAccess;
}

// Address-ordered register list from the Amiga Hardware Reference Manual
// appendix. Direction is a property of the chip: the custom chips decode reads
// and writes separately, so most registers are strictly one or the other.
//
// Omission is safe here and commission is not - a register absent from the
// table simply produces no diagnostic, while a wrong direction produces a
// confident false error. The ECS/AGA display-sync block at $1C0-$1FE is
// therefore left out pending verification; it mixes directions (HHPOSR at $1DA
// is readable) and its ECS/AGA availability varies.
const OCS_READ_ONLY: readonly [number, string][] = [
  [0x000, "BLTDDAT"],
  [0x002, "DMACONR"],
  [0x004, "VPOSR"],
  [0x006, "VHPOSR"],
  [0x008, "DSKDATR"],
  [0x00a, "JOY0DAT"],
  [0x00c, "JOY1DAT"],
  [0x00e, "CLXDAT"],
  [0x010, "ADKCONR"],
  [0x012, "POT0DAT"],
  [0x014, "POT1DAT"],
  [0x016, "POTGOR"],
  [0x018, "SERDATR"],
  [0x01a, "DSKBYTR"],
  [0x01c, "INTENAR"],
  [0x01e, "INTREQR"],
];

// Irregular write-only registers. The repetitive families below are generated
// rather than transcribed, because that is where a slip would hide.
const OCS_WRITE_ONLY: readonly [number, string][] = [
  [0x020, "DSKPTH"],
  [0x022, "DSKPTL"],
  [0x024, "DSKLEN"],
  [0x026, "DSKDAT"],
  [0x028, "REFPTR"],
  [0x02a, "VPOSW"],
  [0x02c, "VHPOSW"],
  [0x02e, "COPCON"],
  [0x030, "SERDAT"],
  [0x032, "SERPER"],
  [0x034, "POTGO"],
  [0x036, "JOYTEST"],
  [0x038, "STREQU"],
  [0x03a, "STRVBL"],
  [0x03c, "STRHOR"],
  [0x03e, "STRLONG"],
  [0x040, "BLTCON0"],
  [0x042, "BLTCON1"],
  [0x044, "BLTAFWM"],
  [0x046, "BLTALWM"],
  [0x048, "BLTCPTH"],
  [0x04a, "BLTCPTL"],
  [0x04c, "BLTBPTH"],
  [0x04e, "BLTBPTL"],
  [0x050, "BLTAPTH"],
  [0x052, "BLTAPTL"],
  [0x054, "BLTDPTH"],
  [0x056, "BLTDPTL"],
  [0x058, "BLTSIZE"],
  [0x05a, "BLTCON0L"],
  [0x05c, "BLTSIZV"],
  [0x05e, "BLTSIZH"],
  [0x060, "BLTCMOD"],
  [0x062, "BLTBMOD"],
  [0x064, "BLTAMOD"],
  [0x066, "BLTDMOD"],
  [0x070, "BLTCDAT"],
  [0x072, "BLTBDAT"],
  [0x074, "BLTADAT"],
  [0x07e, "DSKSYNC"],
  [0x080, "COP1LCH"],
  [0x082, "COP1LCL"],
  [0x084, "COP2LCH"],
  [0x086, "COP2LCL"],
  [0x088, "COPJMP1"],
  [0x08a, "COPJMP2"],
  [0x08c, "COPINS"],
  [0x08e, "DIWSTRT"],
  [0x090, "DIWSTOP"],
  [0x092, "DDFSTRT"],
  [0x094, "DDFSTOP"],
  [0x096, "DMACON"],
  [0x098, "CLXCON"],
  [0x09a, "INTENA"],
  [0x09c, "INTREQ"],
  [0x09e, "ADKCON"],
  [0x100, "BPLCON0"],
  [0x102, "BPLCON1"],
  [0x104, "BPLCON2"],
  [0x106, "BPLCON3"],
  [0x108, "BPL1MOD"],
  [0x10a, "BPL2MOD"],
];

function generatedWriteOnly(): [number, string][] {
  const entries: [number, string][] = [];
  // Audio: four channels of LCH/LCL/LEN/PER/VOL/DAT, 16 bytes apart.
  const audio = ["LCH", "LCL", "LEN", "PER", "VOL", "DAT"];
  for (let channel = 0; channel < 4; channel++) {
    audio.forEach((field, i) =>
      entries.push([0x0a0 + channel * 0x10 + i * 2, `AUD${channel}${field}`]),
    );
  }
  // Bitplane pointers BPL1PTH..BPL6PTL and data BPL1DAT..BPL6DAT.
  for (let plane = 1; plane <= 6; plane++) {
    entries.push([0x0e0 + (plane - 1) * 4, `BPL${plane}PTH`]);
    entries.push([0x0e2 + (plane - 1) * 4, `BPL${plane}PTL`]);
    entries.push([0x110 + (plane - 1) * 2, `BPL${plane}DAT`]);
  }
  // Sprite pointers, then POS/CTL/DATA/DATB per sprite.
  for (let sprite = 0; sprite < 8; sprite++) {
    entries.push([0x120 + sprite * 4, `SPR${sprite}PTH`]);
    entries.push([0x122 + sprite * 4, `SPR${sprite}PTL`]);
    ["POS", "CTL", "DATA", "DATB"].forEach((field, i) =>
      entries.push([0x140 + sprite * 8 + i * 2, `SPR${sprite}${field}`]),
    );
  }
  // COLOR00..COLOR31.
  for (let colour = 0; colour < 32; colour++) {
    entries.push([
      0x180 + colour * 2,
      `COLOR${String(colour).padStart(2, "0")}`,
    ]);
  }
  return entries;
}

export const amigaCustomRegisters = new Map<number, CustomRegister>([
  ...OCS_READ_ONLY.map(
    ([offset, name]) =>
      [0xdff000 + offset, { name, access: "read-only" as const }] as const,
  ),
  ...[...OCS_WRITE_ONLY, ...generatedWriteOnly()].map(
    ([offset, name]) =>
      [0xdff000 + offset, { name, access: "write-only" as const }] as const,
  ),
]);

const CUSTOM_BASE = 0xdff000;

// Canonical Amiga include-file symbols are commonly offsets from CUSTOM, not
// full absolute addresses. Keep this resolver local to the Amiga platform so
// external include files are not required merely to understand hardware EAs.
const amigaCustomSymbolValues = new Map<string, number>();
for (const [address, register] of amigaCustomRegisters) {
  amigaCustomSymbolValues.set(
    register.name.toLowerCase(),
    address - CUSTOM_BASE,
  );
}
amigaCustomSymbolValues.set("custom", CUSTOM_BASE);

function evaluateAmigaExpression(
  ctx: RuleContext,
  expr: ExpressionNode,
): number | undefined {
  const result = evaluateConstant(expr, (name) => {
    const project = ctx.symbols.evaluate(name);
    if (project.known) return project.value;
    return amigaCustomSymbolValues.get(name.toLowerCase());
  });
  return result.known ? result.value : undefined;
}

function knownAddressRegisterBefore(
  ctx: RuleContext,
  lineIndex: number,
  register: Register,
): number | undefined {
  const known = ctx.registers.knownConstantBefore(lineIndex, register);
  if (known !== undefined) return known;

  // Platform symbols such as CUSTOM often come from an external include and
  // therefore are invisible to the generic symbol/register analysis. Recover
  // the common `LEA CUSTOM,An` idiom locally, stopping at the first write to An.
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = ctx.line(i);
    if (!line?.mnemonic || line.mnemonic.type !== "instruction") continue;
    const semantics = getRegisterSemantics(line);
    if (!semantics.writes.has(register)) continue;

    if (semanticMnemonic(line) === "lea") {
      const source = operand(line, 0);
      const dest = operand(line, 1);
      if (
        dest?.type === "address-register" &&
        normalizeRegister(dest.register) === register &&
        source?.type === "absolute-address"
      ) {
        const value = evaluateAmigaExpression(ctx, source.address);
        if (value !== undefined) return value >>> 0;
      }
    }
    return undefined;
  }
  return undefined;
}

/**
 * Resolve an operand to a custom-register address, understanding both literal
 * absolute addresses and the CUSTOM-base include convention. Shared with the
 * bit/mask constant rule so both agree on what counts as a hardware register.
 */
export function amigaEffectiveAddress(
  ctx: RuleContext,
  op: OperandNode | undefined,
  lineIndex: number,
): number | undefined {
  if (!op) return undefined;

  if (op.type === "absolute-address") {
    const value = evaluateAmigaExpression(ctx, op.address);
    return value === undefined ? undefined : value >>> 0;
  }

  if (op.type === "address-register-indirect") {
    if (op.register.type !== "address-register") return undefined;
    const register = normalizeRegister(op.register.register);
    if (!register) return undefined;
    return knownAddressRegisterBefore(ctx, lineIndex, register);
  }

  if (op.type === "address-register-indirect-displacement") {
    if (op.register.type !== "address-register") return undefined;
    const register = normalizeRegister(op.register.register);
    if (!register) return undefined;
    const base = knownAddressRegisterBefore(ctx, lineIndex, register);
    const displacement = evaluateAmigaExpression(ctx, op.displacement);
    if (base === undefined || displacement === undefined) return undefined;
    return (base + displacement) >>> 0;
  }

  return undefined;
}

function operandAccess(line: ParsedLine, index: number): Access | undefined {
  const mnemonic = canonicalMnemonic(line);
  if (!mnemonic) return undefined;

  if (mnemonic === "move" || mnemonic === "movea")
    return index === 0
      ? "read"
      : mnemonic === "move" && index === 1
        ? "write"
        : undefined;
  if (["cmp", "cmpa", "tst", "btst"].includes(mnemonic)) return "read";
  if (["clr", "not", "neg", "negx", "nbcd", "tas"].includes(mnemonic))
    return index === 0 ? "readwrite" : undefined;
  if (["bchg", "bclr", "bset"].includes(mnemonic))
    return index === 1 ? "readwrite" : undefined;
  if (["add", "adda", "sub", "suba", "and", "or", "eor"].includes(mnemonic))
    return index === 0 ? "read" : index === 1 ? "readwrite" : undefined;
  return undefined;
}

function violates(expected: RegisterAccess, actual: Access): boolean {
  return expected === "read-only" ? actual !== "read" : actual !== "write";
}

export const amigaCustomRegisterAccess: Rule = {
  meta: {
    id: "correctness/amiga-custom-register-access",
    category: "correctness",
    defaultSeverity: "warning",
    platforms: ["amiga"],
    description: "Check read/write direction for Amiga custom-chip registers",
    tags: ["amiga", "hardware", "custom-registers"],
    docs: {
      source: "Amiga Hardware Reference Manual",
      note: "Custom-chip registers are read-only or write-only and must be accessed using the documented direction.",
    },
  },
  checkLine(ctx, line, lineIndex) {
    for (let index = 0; index < (line.operands?.length ?? 0); index++) {
      const op = operand(line, index);
      const address = amigaEffectiveAddress(ctx, op, lineIndex);
      if (address === undefined) continue;
      const register = amigaCustomRegisters.get(address);
      if (!register) continue;
      const access = operandAccess(line, index);
      if (!access || !violates(register.access, access)) continue;

      const action =
        access === "read"
          ? "read"
          : access === "write"
            ? "write"
            : "read/modify/write";
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "certain",
        message: `${action} access to ${register.access} Amiga register ${register.name}`,
        loc: op?.loc ?? line.mnemonic!.loc,
        notes: [
          {
            message: `${register.name} at ${hex(address)} is documented as ${register.access}.`,
          },
        ],
      });
    }
  },
};
