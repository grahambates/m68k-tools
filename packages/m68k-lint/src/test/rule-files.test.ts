import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as rules from "../rules/index.js";
import { defaultRules } from "../rules/index.js";

/**
 * Maps each rule file to the rules it defines, by reading the import list in
 * `rules/index.ts` and resolving the exported names. Doing it this way covers
 * rules built by a factory, which a scan of the source text would miss.
 */
function rulesByFile(): Map<string, string[]> {
  const index = readFileSync(
    resolve(process.cwd(), "src/rules/index.ts"),
    "utf8",
  );
  const exported = rules as unknown as Record<
    string,
    { meta?: { id?: string } }
  >;
  const byFile = new Map<string, string[]>();

  for (const match of index.matchAll(
    /import \{([^}]+)\} from "\.\/([^"]+)\.js";/g,
  )) {
    const file = `${match[2]}.ts`;
    for (const name of match[1].split(",").map((value) => value.trim())) {
      const id = exported[name]?.meta?.id;
      if (!id) continue;
      byFile.set(file, [...(byFile.get(file) ?? []), id]);
    }
  }
  return byFile;
}

const SOURCE_NAMES = /flamewing|vasm|asp68k|tricks[-_]?and[-_]?traps|eab/i;

describe("rule file layout", () => {
  test("every rule is reachable through the index", () => {
    const mapped = [...rulesByFile().values()].flat();
    const missing = defaultRules
      .map((rule) => rule.meta.id)
      .filter((id) => !mapped.includes(id));
    expect(missing).toEqual([]);
  });

  test("no file is named after a source corpus", () => {
    // Provenance belongs in rule metadata. Grouping by where a rule came from
    // puts unrelated rules in one file and dates the filename.
    const named = [...rulesByFile().keys()].filter((file) =>
      SOURCE_NAMES.test(basename(file)),
    );
    expect(named).toEqual([]);
  });

  test("a file defining one rule is named after it", () => {
    const wrong: string[] = [];
    for (const [file, ids] of rulesByFile()) {
      if (ids.length !== 1) continue;
      let expected = ids[0].split("/")[1];
      // A platform subdirectory already carries the platform name, so
      // correctness/amiga-tas-unsupported lives in correctness/amiga/tas-unsupported.ts
      // rather than repeating it in the filename.
      const platform = /^[^/]+\/([^/]+)\//.exec(file)?.[1];
      if (platform && expected.startsWith(`${platform}-`))
        expected = expected.slice(platform.length + 1);
      if (basename(file, ".ts") !== expected)
        wrong.push(`${file} defines only ${ids[0]}`);
    }
    expect(wrong).toEqual([]);
  });

  // Deliberately not tested: whether rules grouped in one file are "related".
  // Grouping muls/mulu variants of one transform together is right, and every
  // mechanical check for it flagged those legitimate cases. A guard that fires
  // on correct code is worse than no guard, so this stays a judgement call.
});
