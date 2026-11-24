#!/usr/bin/env node
// Regenerates src/amiga/library-functions.ts: each Amiga OS library function's
// offset from its library base, its arguments and the registers they go in,
// and its page in the Autodocs, for hover on `_LVO` symbols.
//
//   node scripts/generate-library-functions.mjs <sys-include> [autodocs-cache]
//
// <sys-include> is an NDK include directory with the sfdc-generated `lvo/*.i`
// offsets and `inline/*.h` GCC inline calls, as shipped with the
// m68k-amiga-elf toolchains. The offsets, names and registers are the
// libraries' interface; nothing else is taken from the headers.
//
// The Autodocs' index pages are fetched from the Amiga Developer CD 2.1 copy
// at amigadev.elowar.com, over plain HTTP as its certificate has expired, and
// kept in [autodocs-cache] where one is given.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [include, cache] = process.argv.slice(2);
if (!include) {
  console.error(
    "Usage: generate-library-functions.mjs <sys-include> [autodocs-cache]",
  );
  process.exit(1);
}

const base =
  "http://amigadev.elowar.com/read/ADCD_2.1/Includes_and_Autodocs_3._guide/";
/** An Autodocs page, from the cache directory where it has been saved. */
async function page(name) {
  const cached = cache && join(cache, name);
  if (cached && existsSync(cached)) return readFileSync(cached, "utf8");
  const response = await fetch(base + name);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const text = await response.text();
  if (cached) {
    mkdirSync(cache, { recursive: true });
    writeFileSync(cached, text);
  }
  return text;
}

const links = (html) =>
  [
    ...html.matchAll(
      /<a href="\.\.\/Includes_and_Autodocs_3\._guide\/(node[0-9A-F]+\.html)">([^<]+)<\/a>/g,
    ),
  ].map(([, file, text]) => ({ file, text }));

// The root page lists each Autodoc's index page, and that lists its functions.
const autodocs = links(await page("node0000.html")).filter(({ text }) =>
  /^[\w-]+$/.test(text),
);
const autodocIndex = new Map(autodocs.map(({ text, file }) => [text, file]));

/** The pages of an Autodoc's functions, by name in lower case. */
async function autodocPages(autodoc) {
  const pages = new Map();
  for (const { file, text } of links(await page(autodocIndex.get(autodoc))))
    if (text.endsWith("()")) pages.set(text.slice(0, -2).toLowerCase(), file);
  return pages;
}

/**
 * A function's page. A tag list or varargs form is described with the
 * function it calls: AllocDosObjectTagList with AllocDosObject,
 * OpenWindowTagList with OpenWindow... CMove is written CMOVE.
 */
function pageFor(pages, name) {
  const lower = name.toLowerCase();
  const forms = [
    lower,
    lower.replace(/taglist$/, ""),
    lower.replace(/taglist$/, "tags"),
    lower.replace(/a$/, ""),
  ];
  for (const form of forms) if (pages.has(form)) return pages.get(form);
  return undefined;
}

// The Autodoc that documents a library, by its include name: ReAction classes'
// Autodocs say what kind of class they are.
const autodocNames = new Set(autodocs.map(({ text }) => text));
const kinds = { gc: "gadget", ic: "image", cl: "class" };
const devices = new Set(["console", "input", "timer", "ramdrive"]);
const resources = new Set([
  "battclock",
  "battmem",
  "card",
  "disk",
  "misc",
  "potgo",
]);
const fileNames = {
  cia: "ciaa.resource, ciab.resource",
  wb: "workbench.library",
};
const autodocAliases = { card: "cardres" };

function describeLibrary(stem) {
  const autodoc =
    autodocAliases[stem] ??
    [stem, ...Object.keys(kinds).map((kind) => `${stem}_${kind}`)].find(
      (name) => autodocNames.has(name),
    );
  const kind = autodoc?.match(/_(gc|ic|cl)$/)?.[1];
  const name =
    fileNames[stem] ??
    (devices.has(stem)
      ? `${stem}.device`
      : resources.has(stem)
        ? `${stem}.resource`
        : kind
          ? `${stem}.${kinds[kind]}`
          : autodoc
            ? `${stem}.library`
            : // Not in the Autodocs: what kind of library it is is not known.
              stem);
  return { name, autodoc };
}

// The inline calls: `LP2(0x228, struct Library *, OpenLibrary , CONST_STRPTR,
// ___libName, a1, ULONG, ___version, d0,\` and the base on the next line.
// Variants ending A4 or A5 put the argument written as d7 in that register,
// and FP variants give a function pointer type at the end.
function inlineCalls(file) {
  const calls = new Map();
  const text = readFileSync(file, "utf8").replace(/\\\n/g, " ");
  for (const [, macro, body] of text.matchAll(
    /\b(LP\d+(?:NR)?(?:A4|A5)?(?:NR)?(?:UB)?(?:FP)?)\(([^;]*?)\)\s*$/gm,
  )) {
    const fields = body.split(",").map((field) => field.trim());
    const count = Number(macro.match(/^LP(\d+)/)[1]);
    const noReturn = macro.includes("NR");
    fields.shift(); // offset
    const returns = noReturn ? "VOID" : fields.shift();
    const name = fields.shift();
    const fpt = macro.endsWith("FP") ? fields.at(-1) : undefined;
    const pointer = fpt?.replace("__fpt", "");
    const via = macro.match(/A([45])/)?.[1];
    const args = [];
    for (let i = 0; i < count; i++) {
      const [given, arg, written] = fields.slice(i * 3, i * 3 + 3);
      const type = given === "__fpt" ? pointer : given;
      let register = via && written === "d7" ? `a${via}` : written;
      // A double goes in a pair of data registers.
      if (type === "DOUBLE")
        register = `${register}/d${Number(register.slice(1)) + 1}`;
      args.push({ type, name: arg.replace(/^___/, ""), register });
    }
    calls.set(name, { returns, args });
  }
  return calls;
}

const libraries = [];
const functions = [];
const files = readdirSync(join(include, "lvo"))
  .filter((file) => file.endsWith("_lib.i"))
  .sort();
for (const file of files) {
  const stem = basename(file, "_lib.i");
  const lvo = readFileSync(join(include, "lvo", file), "utf8");
  const inlineFile = join(include, "inline", `${stem}.h`);
  const calls = inlineCalls(inlineFile);
  const baseName = readFileSync(inlineFile, "utf8").match(
    /_BASE_NAME (\w+)/,
  )?.[1];
  const library = describeLibrary(stem);
  const pages = library.autodoc
    ? await autodocPages(library.autodoc)
    : new Map();
  const libraryIndex = libraries.length;
  libraries.push({ ...library, base: baseName });
  for (const [, name, offset] of lvo.matchAll(/^_LVO(\w+)\s+EQU\s+(-?\d+)/gm)) {
    const call = calls.get(name);
    functions.push({
      name,
      library: libraryIndex,
      offset: Number(offset),
      call,
      page: pageFor(pages, name),
    });
  }
}

if (functions.length < 1000)
  throw new Error(`Only ${functions.length} functions found`);
const linked = functions.filter((fn) => fn.page).length;
if (linked < 700)
  throw new Error(
    `Only ${linked} functions linked to the Autodocs; has the index changed?`,
  );

const signature = (call) =>
  call
    ? [
        call.returns,
        ...call.args.map(
          ({ type, name, register }) => `${type}|${name}|${register}`,
        ),
      ].join(";")
    : "";

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/amiga/library-functions.ts",
);
writeFileSync(
  out,
  [
    "// Generated by scripts/generate-library-functions.mjs. Do not edit by hand.",
    "// Offsets and registers from the NDK's sfdc-generated lvo and inline",
    "// headers (Includes Release 45.1); Autodoc pages from the Amiga Developer",
    "// CD 2.1.",
    "",
    "/** The Amiga Developer CD 2.1 copy of the Includes and Autodocs. */",
    `export const AUTODOCS_BASE =\n  ${JSON.stringify(base)};`,
    "",
    "/**",
    " * Each library: its name, as opened, where known; its base's name in the",
    " * includes; and its Autodoc's index page.",
    " */",
    "export const libraryTable: readonly (readonly [",
    "  name: string,",
    "  base: string,",
    "  autodoc: string,",
    "])[] = [",
    ...libraries.map(
      ({ name, base, autodoc }) =>
        `  ${JSON.stringify([name, base ?? "", autodoc ? autodocIndex.get(autodoc) : ""])},`,
    ),
    "];",
    "",
    "/**",
    " * Each function: its name; its library, as an index into libraryTable; its",
    " * offset from the base; its return type, then each argument's",
    ' * `type|name|register`, separated by ";"; and its Autodoc page.',
    " */",
    "export const libraryFunctionTable: readonly (readonly [",
    "  name: string,",
    "  library: number,",
    "  offset: number,",
    "  signature: string,",
    "  page: string,",
    "])[] = [",
    ...functions.map(
      (fn) =>
        `  ${JSON.stringify([fn.name, fn.library, fn.offset, signature(fn.call), fn.page ?? ""])},`,
    ),
    "];",
    "",
  ].join("\n"),
);
console.log(
  `Wrote ${out} (${libraries.length} libraries, ${functions.length} functions, ${linked} linked)`,
);
