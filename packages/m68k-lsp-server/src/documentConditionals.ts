import { symbolKey, type BlockStructure, type ParsedFile } from "m68k-parser";
import { symbolsCaseSensitive } from "./config";
import type { Context } from "./context";
import { configFor } from "./documentConfigs";
import { getIncluded, getIncluders } from "./files";
import { analyzeConditionals } from "./inactiveConditionals";

export function analyzeDocumentConditionals(
  ctx: Context,
  uri: string,
  parsed: ParsedFile,
  blocks: BlockStructure,
  line?: number,
) {
  const conf = configFor(ctx, uri);
  const includes = ctx.store.get(uri)?.resolvedIncludeLines;
  return analyzeConditionals(
    parsed,
    blocks,
    conf,
    (line) => {
      const included = includes?.get(line);
      return included ? ctx.store.get(included)?.assemblyConstants : undefined;
    },
    line === undefined,
    (line, name, fromCurrentInclude) => {
      if (getIncluders(uri, ctx).length) return true;
      const key = (value: string) =>
        symbolKey(value, symbolsCaseSensitive(conf));
      const target = key(name);
      const currentInclude = fromCurrentInclude
        ? includes?.get(line)
        : undefined;
      return parsed.lines.slice(0, line).some(({ label, mnemonic }, index) => {
        if (label && key(label.label) === target) return true;
        if (mnemonic?.type === "macro" || mnemonic?.type === "macro-parameter")
          return true;
        if (mnemonic?.type !== "directive" || mnemonic.directive !== "include")
          return false;
        const included = includes?.get(index);
        if (!included) return true;
        return [included, ...getIncluded(included, ctx)].some((file) => {
          // A previous inclusion of this same guarded header contributes
          // the same constants, even if the current include would be skipped.
          if (file === currentInclude) return false;
          const indexed = ctx.store.get(file);
          return (
            !indexed ||
            indexed.symbols.includes.length !==
              (indexed.resolvedIncludeLines?.size ?? 0) ||
            [...indexed.symbols.definitions.keys()].some(
              (symbol) => key(symbol) === target,
            )
          );
        });
      });
    },
    line,
    // vasm starts the offset counters at 0, which is where they stand in
    // a file nothing includes.
    getIncluders(uri, ctx).length ? undefined : 0,
  );
}
