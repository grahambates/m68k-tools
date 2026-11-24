import type { ExpressionNode, ParsedFile } from "m68k-parser";
import {
  CIA_BASE,
  customRegisterSymbols,
  CUSTOM_BASE,
} from "@m68k-lsp/platforms";
import { descendants, type AstNode } from "./ast";
import type { Context } from "./context";
import { configFor } from "./documentConfigs";

/** The machines the server knows the hardware and OS of. */
export type Platform = "amiga";

export const knownPlatforms: readonly Platform[] = ["amiga"];

/**
 * Which platform's features are on: `auto`, the default, has those that go by
 * standard names on everywhere, and those that go by addresses alone on for
 * the platforms the workspace shows signs of; a platform's name has all of its
 * features on and no other's; `none` has none.
 */
export type PlatformSetting = "auto" | "none" | Platform;

/**
 * Directories of the Amiga includes: `include "hardware/custom.i"` or
 * `include "exec/exec_lib.i"`.
 */
const amigaIncludes =
  /(^|[/\\])(exec|hardware|graphics|intuition|dos|libraries|devices|resources|workbench|lvo)[/\\][\w.]+\.i$/i;

/** Base symbols the Amiga includes and their users name. */
const amigaBases = new Set([
  "custom",
  "_custom",
  "ciaa",
  "_ciaa",
  "ciab",
  "_ciab",
]);

/** Whether an address is an Amiga custom chip or CIA register. */
export function isAmigaHardwareAddress(value: number): boolean {
  const address = value >>> 0;
  if (address >= CUSTOM_BASE && address < CUSTOM_BASE + 0x200) return true;
  for (const base of [CIA_BASE.A, CIA_BASE.B]) {
    const offset = address - base;
    if (offset >= 0 && offset <= 0xf00 && (offset & 0xff) === 0) return true;
  }
  return false;
}

/**
 * The platforms a file shows signs of being written for. For the Amiga: its
 * includes, a library offset symbol (`_LVOOpenLibrary`), the custom chip and
 * CIA base symbols, a custom register symbol used as a displacement
 * (`dmacon(a6)`), or a number that is a hardware register's address
 * (`$dff096`, `$bfe001`).
 */
export function platformEvidence(parsed: ParsedFile): Platform[] {
  for (const line of parsed.lines) {
    if (
      line.mnemonic?.type === "directive" &&
      line.mnemonic.directive.toLowerCase() === "include"
    ) {
      const path = line.operands?.[0];
      const text = path?.type === "string-literal" ? path.content : undefined;
      if (text && amigaIncludes.test(text)) return ["amiga"];
    }
    for (const operand of line.operands ?? []) {
      if (
        operand.type === "address-register-indirect-displacement" &&
        operand.displacement.type === "symbol" &&
        customRegisterSymbols.has(operand.displacement.name.toLowerCase())
      )
        return ["amiga"];
      for (const node of [operand, ...descendants(operand as AstNode)]) {
        const expr = node as unknown as ExpressionNode;
        if (expr.type === "symbol") {
          const name = expr.name.toLowerCase();
          if (name.startsWith("_lvo") || amigaBases.has(name)) return ["amiga"];
        } else if (
          expr.type === "numeric-literal" &&
          isAmigaHardwareAddress(expr.value)
        )
          return ["amiga"];
      }
    }
  }
  return [];
}

/**
 * The platform setting in force for a document: its nearest `.m68krc.json`,
 * so a project building for several machines can name each build's own, else
 * the workspace's.
 */
const setting = (ctx: Context, uri: string): PlatformSetting =>
  configFor(ctx, uri).platform ?? "auto";

/**
 * Whether a platform's features that go by standard names are on: Amiga
 * register and flag symbols, library offsets.
 */
export function namedFeaturesOn(
  ctx: Context,
  uri: string,
  platform: Platform,
): boolean {
  const value = setting(ctx, uri);
  return value === "auto" || value === platform;
}

/**
 * Whether a platform's features that go by addresses alone are on, which a
 * number could mean on another machine: `move.w d0,$dff180`, or `$96(a6)`
 * after `lea $dff000,a6`. Under `auto`, a sign of the platform in any file of
 * the workspace counts.
 */
export function addressFeaturesOn(
  ctx: Context,
  uri: string,
  platform: Platform,
): boolean {
  const value = setting(ctx, uri);
  if (value !== "auto") return value === platform;
  for (const doc of ctx.store.values())
    if (doc.platforms?.includes(platform)) return true;
  return false;
}
