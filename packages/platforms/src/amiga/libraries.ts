/**
 * Amiga OS library functions, called through their library's base in A6 at a
 * negative offset: `jsr _LVOOpenLibrary(a6)`. The includes name each offset
 * `_LVO` and the function's name.
 */
import {
  AUTODOCS_BASE,
  libraryFunctionTable,
  libraryTable,
} from "./library-functions.js";

export interface Library {
  /** The name it is opened by, `exec.library`, or its include name. */
  name: string;
  /** Its base's name in the includes, `SysBase`, where it has one. */
  base?: string;
  /** Its Autodoc's index, where there is one. */
  url?: string;
}

export interface LibraryArgument {
  /** The C type, `CONST_STRPTR`. */
  type: string;
  name: string;
  /** The register it goes in, `a1`, or a pair for a double, `d0/d1`. */
  register: string;
}

export interface LibraryFunction {
  name: string;
  library: Library;
  /** The offset from the library base: negative. */
  offset: number;
  /** The C return type, `VOID` for none. Results come back in D0. */
  returns?: string;
  /** The arguments, where the includes say; undefined where not known. */
  args?: readonly LibraryArgument[];
  /** Its Autodoc page, where there is one. */
  url?: string;
}

const libraries: readonly Library[] = libraryTable.map(
  ([name, base, page]) => ({
    name,
    base: base || undefined,
    url: page ? AUTODOCS_BASE + page : undefined,
  }),
);

function parse(entry: (typeof libraryFunctionTable)[number]): LibraryFunction {
  const [name, library, offset, signature, page] = entry;
  const [returns, ...args] = signature ? signature.split(";") : [];
  return {
    name,
    library: libraries[library],
    offset,
    returns,
    args: signature
      ? args.map((arg) => {
          const [type, argName, register] = arg.split("|");
          return { type, name: argName, register };
        })
      : undefined,
    url: page ? AUTODOCS_BASE + page : undefined,
  };
}

let byName: Map<string, (typeof libraryFunctionTable)[number]> | undefined;

/**
 * The function an offset symbol names, `_LVOOpenLibrary`, in either case and
 * with or without the leading underscore; or the function's own name, with
 * `bare`, for macros that add the prefix themselves, `CALLEXEC OpenLibrary`.
 */
export function libraryFunction(
  symbol: string,
  { bare = false } = {},
): LibraryFunction | undefined {
  byName ??= new Map(
    libraryFunctionTable.map((entry) => [entry[0].toLowerCase(), entry]),
  );
  const lower = symbol.toLowerCase();
  const name = bare ? lower : lower.match(/^_?lvo(\w+)$/)?.[1];
  const entry = name && byName.get(name);
  return entry ? parse(entry) : undefined;
}

/** A C-style prototype, with each argument's register. */
export function libraryFunctionSynopsis(fn: LibraryFunction): string {
  if (!fn.args) return `${fn.name}()`;
  const type = (t: string) => (t.endsWith("*") ? t : `${t} `);
  const args = fn.args.map(
    (arg) => `${type(arg.type)}${arg.name} /* ${arg.register} */`,
  );
  const returns = type(fn.returns === "VOID" ? "void" : fn.returns!);
  return `${returns}${fn.name}(${args.join(", ")})`;
}
