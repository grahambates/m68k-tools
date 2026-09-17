import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(__dirname, "../cli.js");
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "m68k-format-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
const run = (args: string[], input = "") => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    input,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result;
};

it("formats stdin and supports check mode without changing source", () => {
  const result = run([], " NOP");
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("        nop\n");
  expect(run(["--check"], " NOP").status).toBe(1);
  expect(run(["--check"], result.stdout).status).toBe(0);
});

it("expands quoted globs, checks and writes files", () => {
  writeFileSync(join(directory, "a.s"), " NOP");
  writeFileSync(join(directory, "b.s"), " RTS");
  expect(run(["--check", "*.s"]).status).toBe(1);
  expect(readFileSync(join(directory, "a.s"), "utf8")).toBe(" NOP");
  expect(run(["--write", "*.s"]).status).toBe(0);
  expect(readFileSync(join(directory, "a.s"), "utf8")).toBe("        nop\n");
  expect(run(["--check", "*.s"]).status).toBe(0);
});

it("discovers nearest config for files and stdin and accepts explicit config", () => {
  mkdirSync(join(directory, "src"));
  writeFileSync(
    join(directory, ".m68k-format.json"),
    JSON.stringify({ case: "upper", align: { mnemonic: 4 } }),
  );
  writeFileSync(join(directory, "src/a.s"), " nop");
  expect(run(["src/a.s"]).stdout).toBe("    NOP\n");
  expect(run(["--stdin-filepath", "src/a.s"], " nop").stdout).toBe("    NOP\n");
  writeFileSync(
    join(directory, "src/.m68k-format.json"),
    JSON.stringify({ align: { mnemonic: 2 } }),
  );
  expect(run(["src/a.s"]).stdout).toBe("  nop\n");
  expect(run(["--config", ".m68k-format.json", "src/a.s"]).stdout).toBe(
    "    NOP\n",
  );
});

it.each([
  ["--write"],
  ["--check", "--write"],
  ["--unknown"],
  ["missing.s"],
  ["--config"],
  ["-", "a.s"],
  ["--config", "missing.json"],
])("reports invalid invocation %j with exit 2", (...args) => {
  const result = run(args);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("m68k-format:");
});

it("refuses --init without an interactive terminal", () => {
  const result = run(["--init"]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("--init needs an interactive terminal");
});

it("rejects malformed config before writing any files", () => {
  writeFileSync(join(directory, "a.s"), " NOP");
  writeFileSync(
    join(directory, ".m68k-format.json"),
    '{"align":{"indentMacro":-1}}',
  );
  expect(run(["--write", "a.s"]).status).toBe(2);
  expect(readFileSync(join(directory, "a.s"), "utf8")).toBe(" NOP");
});
