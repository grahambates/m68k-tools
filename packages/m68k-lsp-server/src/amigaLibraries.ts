import type { ParsedLine } from "m68k-parser";
import {
  libraryFunction,
  libraryFunctionSynopsis,
  type LibraryFunction,
} from "@m68k-lsp/platforms";
import { hex } from "./amigaHardware";

/**
 * Documentation for an Amiga OS library function's offset symbol, as the
 * includes name it: `_LVOOpenLibrary`, in any case. Where the project defines
 * the symbol, its value must be the function's offset.
 *
 * In the operands of a macro whose name starts with "call", such as
 * `CALLEXEC OpenLibrary`, the function's name alone is taken to mean it, as
 * such macros add the prefix, unless the project gives the name a value.
 */
export function libraryFunctionDocs(
  name: string,
  value: number | undefined,
  line: ParsedLine,
): string | undefined {
  const prefixed = libraryFunction(name);
  if (prefixed)
    return value === undefined || value === prefixed.offset
      ? describe(prefixed)
      : undefined;
  if (value !== undefined || !isCallMacro(line)) return undefined;
  const bare = libraryFunction(name, { bare: true });
  return bare && describe(bare);
}

const isCallMacro = (line: ParsedLine) =>
  line.mnemonic?.type === "macro" && /^call/i.test(line.mnemonic.macro);

function describe(fn: LibraryFunction): string {
  const { library } = fn;
  const heading = `**${fn.name}** · ${library.name} · offset ${fn.offset} (-${hex(-fn.offset)})`;
  const parts = [heading];
  if (fn.args) parts.push("```c\n" + libraryFunctionSynopsis(fn) + "\n```");
  // A resource's functions can take their base as an argument in A6.
  const takesBase = fn.args?.some((arg) => arg.register === "a6");
  const call = takesBase
    ? []
    : [
        `Call with the library base${library.base ? `, ${library.base},` : ""} in A6`,
      ];
  const result =
    fn.returns && fn.returns !== "VOID"
      ? [`the result is in ${fn.returns === "DOUBLE" ? "D0/D1" : "D0"}`]
      : [];
  const sentence = [...call, ...result].join("; ");
  if (sentence) parts.push(sentence[0].toUpperCase() + sentence.slice(1) + ".");
  const links = [library.url && `[${library.name}](${library.url})`];
  if (fn.url) links.unshift(`[Autodoc](${fn.url})`);
  const linkLine = links.filter(Boolean).join(" · ");
  if (linkLine) parts.push(linkLine);
  return parts.join("\n\n");
}
