import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { glob } from "glob";
import { format, findConfig, loadConfig, type FormatterOptions } from "./index";
import { runInit } from "./cli/init";

const help = `Usage: m68k-format [--write | --check] [--config FILE] [FILES / GLOBS ...]

Without --write or --check, writes formatted source to stdout.
With no files (or -), reads stdin. Stdin cannot be mixed with files.
  --write          Update files in place (not supported for stdin)
  --check          Report unformatted files; exit 1 if changes are needed
  --config FILE    Use this JSON configuration instead of discovery
  --stdin-filepath FILE  Discover configuration relative to this stdin path
  --init           Create a project config file interactively
  --help           Show this help
  --               Treat remaining arguments as file paths

Discovers .m68k-format.json from each file's directory upwards.
Exit codes: 0 success, 1 formatting required, 2 error.
`;

export async function main(args = process.argv.slice(2)): Promise<number> {
  let write = false,
    check = false,
    literal = false,
    init = false;
  let configPath: string | undefined, stdinPath: string | undefined;
  const patterns: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (literal) patterns.push(arg);
    else if (arg === "--") literal = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(help);
      return 0;
    } else if (arg === "--write") write = true;
    else if (arg === "--check") check = true;
    else if (arg === "--init") init = true;
    else if (arg === "--config" || arg === "--stdin-filepath") {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a path`);
      if (arg === "--config") configPath = resolve(value);
      else stdinPath = resolve(value);
    } else if (arg.startsWith("-") && arg !== "-")
      throw new Error(`Unknown option: ${arg}`);
    else patterns.push(arg);
  }
  if (init) return runInit();
  if (write && check) throw new Error("--write and --check cannot be combined");
  const stdin = patterns.length === 0 || patterns.includes("-");
  if (stdin && patterns.length > 1)
    throw new Error("Stdin cannot be mixed with files");
  if (stdin && write) throw new Error("--write requires files");
  if (!stdin && stdinPath) throw new Error("--stdin-filepath requires stdin");

  const configs = new Map<string, FormatterOptions>();
  const optionsFor = async (directory: string): Promise<FormatterOptions> => {
    const path = configPath ?? (await findConfig(directory));
    if (!path) return {};
    if (!configs.has(path)) configs.set(path, await loadConfig(path));
    return configs.get(path)!;
  };
  if (stdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const source = Buffer.concat(chunks).toString("utf8");
    const result = format(
      source,
      await optionsFor(stdinPath ? dirname(stdinPath) : process.cwd()),
    );
    if (!check) process.stdout.write(result);
    else if (result !== source)
      process.stderr.write("stdin needs formatting\n");
    return check && result !== source ? 1 : 0;
  }

  const files = new Set<string>();
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      absolute: true,
      nodir: true,
      ignore: ["**/node_modules/**", "**/.git/**"],
    });
    if (!matches.length) throw new Error(`No files matched: ${pattern}`);
    for (const file of matches.sort()) files.add(file);
  }
  // Read and format everything before writing, so configuration/read errors
  // cannot leave a partially formatted batch.
  const results = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    results.push({
      file,
      source,
      result: format(source, await optionsFor(dirname(file))),
    });
  }
  let changed = false;
  for (const { file, source, result } of results) {
    if (source !== result) {
      changed = true;
      if (write) await writeFile(file, result);
      if (check) process.stderr.write(`${file} needs formatting\n`);
    }
    if (!write && !check) process.stdout.write(result);
  }
  return check && changed ? 1 : 0;
}
