import { symbolKey } from "m68k-parser";
import { symbolsCaseSensitive } from "./config";
import { type Context } from "./context";
import { getUnitFilesByDistance } from "./files";

export function findMacroDefinition(
  name: string,
  documentUri: string,
  ctx: Context,
) {
  const key = symbolKey(name, symbolsCaseSensitive(ctx.config));
  for (const uri of [
    documentUri,
    ...getUnitFilesByDistance(documentUri, ctx),
  ]) {
    const definition = ctx.store.get(uri)?.macros.get(key);
    if (definition) return { uri, definition };
  }
}
