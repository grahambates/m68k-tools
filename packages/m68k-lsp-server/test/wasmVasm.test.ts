import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const launcher = join(__dirname, "..", "wasm", "vasmm68k_mot");

it("assembles to disk and reports failed builds through the bundled vasm launcher", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "m68k-vasm-"));
  try {
    await writeFile(join(cwd, "main source.s"), ' include "body.i"\n');
    await writeFile(join(cwd, "body.i"), " nop\n");
    await run(
      process.execPath,
      [launcher, "-Fbin", "-o", "output file.bin", "main source.s"],
      { cwd },
    );
    expect(await readFile(join(cwd, "output file.bin"))).toEqual(
      Buffer.from([0x4e, 0x71]),
    );

    await writeFile(join(cwd, "main source.s"), ' include "missing.i"\n');
    await expect(
      run(process.execPath, [launcher, "-Fbin", "main source.s"], { cwd }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('in line 1 of "main source.s"'),
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
