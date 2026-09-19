/**
 * Running the real vasm, for checks that compare what our tools believe with
 * what the assembler does.
 *
 * Nothing here is needed to build or test the packages: the checks that use it
 * skip themselves when no binary is found. Point `VASM` at one, or have
 * `vasmm68k_mot` on the PATH.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The vasm binary to use, or undefined if there is none. */
export function findVasm() {
  const candidates = [process.env.VASM, "vasmm68k_mot"].filter(Boolean);
  for (const candidate of candidates) {
    const found = spawnSync(candidate, ["-quiet"], { encoding: "utf8" });
    if (!found.error) return candidate;
  }
  return undefined;
}

let scratch;
let counter = 0;

/**
 * Assemble a source and say what came out.
 *
 * Optimisation is off unless asked for, so what is assembled is the
 * instruction as written and not one vasm has already improved on. Each call
 * gets its own files, so calls can run at the same time.
 *
 * @returns `bytes` is the raw output, or undefined if vasm reported an error;
 *   `messages` is everything it printed.
 */
export async function assemble(vasm, source, options = {}) {
  scratch ??= await mkdtemp(join(tmpdir(), "m68k-vasm-check-"));
  const id = counter++;
  const input = join(scratch, `${id}.s`);
  const output = join(scratch, `${id}.bin`);
  await writeFile(input, source);

  const args = [
    "-quiet",
    "-Fbin",
    ...(options.optimise ? [] : ["-no-opt"]),
    ...(options.args ?? []),
    input,
    "-o",
    output,
  ];
  const messages = await new Promise((resolve) => {
    const child = spawn(vasm, args, { cwd: options.cwd ?? scratch });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("error", () => resolve(text));
    child.on("close", () => resolve(text));
  });
  let bytes;
  if (!/(?:^|\n)(?:fatal )?error \d+/.test(messages)) {
    bytes = await readFile(output).catch(() => undefined);
  }
  await rm(input, { force: true });
  await rm(output, { force: true });
  return { bytes, messages };
}

/** Run `work` over `items`, a few at a time, keeping the results in order. */
export async function inParallel(items, work, width = 8) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}

export async function cleanUp() {
  if (scratch) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
}
