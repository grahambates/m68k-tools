/**
 * The instruction corpus 68kcounter is tested with, prepared for assembling one
 * line at a time.
 */
import { readFile } from "node:fs/promises";

const file = new URL(
  "../../packages/68kcounter/test/examples/instructions.s",
  import.meta.url,
);

export async function loadCorpus() {
  const lines = (await readFile(file, "utf8")).split("\n");
  // The constants the corpus defines before its first instruction.
  const header = lines.filter((line) => /^\w+\s*=/.test(line)).join("\n");
  // Its branches go to aaa..ddd and yyy without defining them. They are put two
  // bytes on, so a short branch has somewhere in range to go, and those two
  // bytes are not counted.
  const targets = ["aaa", "bbb", "ccc", "ddd", "yyy"]
    .map((name) => `${name}:`)
    .join("\n");
  const instructions = [];
  lines.forEach((text, index) => {
    if (/^\s+[a-z]/i.test(text)) instructions.push({ text, line: index + 1 });
  });
  return {
    lines,
    instructions,
    /** Source to assemble for one line of the corpus. */
    source: (text) => `${header}\n${text}\n\tnop\n${targets}\n`,
    /** What the trailing nop and labels add. */
    padding: 2,
  };
}
