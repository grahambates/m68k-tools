import type { Rule } from "../../../core/rule.js";
import type { RuleContext } from "../../../core/context.js";
import type { DiagnosticNote } from "../../../core/diagnostic.js";
import { analyzeSections, type Section } from "../../../analysis/sections.js";
import {
  labelLoadsReaching,
  targetLabel,
  type LabelLoad,
} from "../../../analysis/label-addresses.js";
import { conditionalAssembly } from "../../../analysis/conditionals.js";
import { scanBlocks } from "../../../analysis/blocks.js";
import { semanticMnemonic } from "../../../semantics/mnemonics.js";
import { normalizeRegister } from "../../../semantics/registers.js";
import { instructionSize, operand } from "../../../util/ast.js";
import {
  amigaCustomRegisters,
  amigaEffectiveAddress,
} from "./custom-register-access.js";

/** What each DMA channel fetches from or stores to, by pointer register. */
const CHANNELS: readonly [RegExp, string][] = [
  [/^COP[12]LCH$/, "copper list"],
  [/^AUD[0-3]LCH$/, "audio sample"],
  [/^BLT[ABC]PTH$/, "blitter source"],
  [/^BLTDPTH$/, "blitter destination"],
  [/^BPL[1-6]PTH$/, "bitplane"],
  [/^SPR[0-7]PTH$/, "sprite data"],
  [/^DSKPTH$/, "disk buffer"],
];

/**
 * DMA pointer registers, by address: the high word of each pair, where a long
 * write sets the whole pointer.
 */
const DMA_POINTERS = new Map<number, { name: string; data: string }>();
for (const [address, register] of amigaCustomRegisters) {
  const channel = CHANNELS.find(([pattern]) => pattern.test(register.name));
  if (channel)
    DMA_POINTERS.set(address, {
      name: register.name.slice(0, -1),
      data: channel[1],
    });
}

/**
 * Custom-chip DMA reaches only chip RAM. A section without a memory attribute
 * is loaded wherever AmigaDOS finds room, which is fast RAM first on a machine
 * that has it, so data the chips read or write must be in a chip section.
 *
 * The pointer is followed when a long MOVE writes it with a label's address,
 * either as an immediate or from a register that was loaded with one. Pointers
 * written into a copper list, and addresses worked out at run time, are not
 * followed.
 */
export const amigaDmaOutsideChipRam: Rule = {
  meta: {
    id: "correctness/amiga-dma-outside-chip-ram",
    category: "correctness",
    defaultSeverity: "error",
    platforms: ["amiga"],
    description:
      "Flag a DMA pointer set to a label in a section that is not in chip RAM",
    tags: ["amiga", "hardware", "chip-ram", "dma", "sections"],
    docs: {
      source: "Amiga Hardware Reference Manual",
      note: "Covers the copper, audio, blitter, bitplane, sprite and disk pointers when a long MOVE writes one with a label's address, directly as `#label` or from a register loaded by `lea label,An`, `move.l #label,Rn` or a copy of one. The register is followed back through the code before it, and a path through a subroutine call or an opaque macro is given up. A section with no memory attribute is reported because it goes in fast RAM whenever there is any; it works on a machine with only chip RAM, which is how this goes unnoticed. Pointers poked into a copper list's `dc.w` words, and addresses computed at run time, are not followed, and only labels this file defines are checked.",
    },
  },

  checkFile(ctx) {
    const sections = analyzeSections(ctx.file);
    const blocks = scanBlocks(ctx.file);
    const assembly = conditionalAssembly(ctx.file);

    ctx.file.lines.forEach((line, index) => {
      if (line.mnemonic?.type !== "instruction") return;
      if (blocks.region[index] !== 0 || assembly.unassembled[index]) return;
      const mnemonic = semanticMnemonic(line);
      if (mnemonic !== "move" || instructionSize(line) !== "l") return;

      const address = amigaEffectiveAddress(ctx, operand(line, 1), index);
      const pointer =
        address === undefined ? undefined : DMA_POINTERS.get(address);
      if (!pointer) return;

      const source = operand(line, 0);
      let loads: LabelLoad[] = [];
      if (source?.type === "immediate") {
        const name = targetLabel(ctx, source.value);
        if (name !== undefined) loads = [{ name, index }];
      } else if (
        source?.type === "address-register" ||
        source?.type === "data-register"
      ) {
        const register = normalizeRegister(source.register);
        if (register) loads = labelLoadsReaching(ctx, index, register);
      }

      for (const load of loads) {
        const section = sections.ofLabel(load.index, load.name);
        if (!section || section.memory === "chip") continue;
        report(
          ctx,
          index,
          load,
          section,
          pointer,
          sections.directivesOf(section),
        );
      }
    });
  },
};

function report(
  ctx: RuleContext,
  index: number,
  load: LabelLoad,
  section: Section,
  pointer: { name: string; data: string },
  directives: readonly number[],
): void {
  const line = ctx.file.lines[index];
  const source = operand(line, 0)!;
  const where =
    section.label === section.kind
      ? `the ${section.kind} section`
      : `section ${section.label}`;
  const Where = where[0].toUpperCase() + where.slice(1);
  const chip =
    section.label === section.kind
      ? `${section.kind}_c`
      : `section ${section.label},${section.kind}_c`;
  const opened = directives[0];
  const openedLine =
    opened === undefined
      ? undefined
      : (ctx.file.lines[opened]?.lineNumber ?? opened + 1);

  const notes: DiagnosticNote[] = [
    {
      message:
        section.memory === "fast"
          ? `${Where} is loaded into fast RAM, which the custom chips cannot reach.`
          : `${Where} has no memory attribute, so AmigaDOS loads it into fast RAM whenever the machine has any. The custom chips can only reach chip RAM, so this works on a machine with chip RAM alone and fails on one with fast RAM.`,
    },
  ];
  if (load.index !== index) {
    const loadLine = ctx.file.lines[load.index];
    notes.push({
      message: `${load.name} is loaded here.`,
      loc: loadLine.mnemonic?.loc,
    });
  }

  ctx.report({
    ruleId: amigaDmaOutsideChipRam.meta.id,
    category: amigaDmaOutsideChipRam.meta.category,
    severity: amigaDmaOutsideChipRam.meta.defaultSeverity,
    confidence: section.memory === "fast" ? "certain" : "high",
    message: `${pointer.name} is set to ${load.name}, which is not in chip RAM`,
    loc: source.loc,
    notes,
    suggestion: {
      description: `Put the ${pointer.data} at ${load.name} in a chip section such as ${chip}${
        openedLine === undefined
          ? ""
          : ` (${where} opens on line ${openedLine})`
      }. Moving just that data to a section of its own keeps the rest out of chip RAM.`,
      applicability: "manual",
    },
  });
}
