/**
 * Instruction sizes: 68kcounter's against what vasm assembles.
 *
 * Each instruction of the counter's own timing corpus is assembled on its own,
 * without optimisation so that it is the instruction as written, and its length
 * compared with the size 68kcounter gives it. vasm rejecting a line is reported
 * separately: the corpus lists every form the timing tables cover, including
 * some an assembler will not take, and those say nothing about size.
 *
 * Run from the repository root after `pnpm build`.
 */
import { createRequire } from "node:module";
import { loadCorpus } from "./corpus.mjs";
import { assemble, findVasm, inParallel, cleanUp } from "./vasm.mjs";

const require = createRequire(import.meta.url);
const parse = require("../../packages/68kcounter").default;

const vasm = findVasm();
if (!vasm) {
  console.log("vasm not found (set VASM): skipping the size check");
  process.exit(0);
}

const corpus = await loadCorpus();
const parsed = parse(corpus.lines.join("\n"));

const results = await inParallel(corpus.instructions, async (c) => {
  const { bytes, messages } = await assemble(vasm, corpus.source(c.text));
  return {
    ...c,
    ours: parsed[c.line - 1]?.bytes,
    vasm: bytes && bytes.length - corpus.padding,
    messages,
  };
});

const rejected = results.filter((r) => r.vasm === undefined);
const differ = results.filter((r) => r.vasm !== undefined && r.vasm !== r.ours);
console.log(
  `${results.length} instructions: ${results.length - rejected.length - differ.length} agree, ${differ.length} differ, ${rejected.length} rejected by vasm`,
);
for (const r of differ.slice(0, 40))
  console.log(
    `  line ${r.line}: ${r.text.trim()}  ours ${r.ours}, vasm ${r.vasm}`,
  );
if (process.argv.includes("--rejected"))
  for (const r of rejected)
    console.log(
      `  rejected line ${r.line}: ${r.text.trim().split(/\s{2,}/)[0]}  ${r.messages
        .trim()
        .split("\n")[0]
        .replace(/ in line \d+ of "[^"]*"/, "")}`,
    );

await cleanUp();
process.exitCode = differ.length ? 1 : 0;
