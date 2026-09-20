import type { BlockStructure, ParsedFile } from "m68k-parser";
import {
  type Diagnostic,
  DiagnosticSeverity,
  type Range,
} from "vscode-languageserver";
import { URI } from "vscode-uri";
import which from "which";
import * as cp from "child_process";
import { tmpdir } from "os";
import { basename, dirname, join, relative } from "path";
import { minimatch } from "minimatch";

import { assemblerArgs, vasmRunDirectory } from "./config";
import { type InferredDirectory } from "@m68k-lsp/assembly-options";
import { existsSync } from "fs";
import {
  includeNotes,
  inferDirectories,
  inferenceDiagnostic,
  unresolvedIncludes,
} from "./includeInference";
import { type Context } from "./context";
import { getEntryPointsFor } from "./files";
import { instructionDocs } from "./docs";
import { locationAsRange } from "m68k-parser";

const wasmPath = join(__dirname, "..", "wasm", "vasmm68k_mot");

export interface VasmOptions {
  provideDiagnostics: boolean;
  preferWasm: boolean;
  binPath: string;
  args: string[];
  exclude: string[];
}

/** The most times vasm is run again for includes it could not find. */
const MAX_INFERENCE_RUNS = 5;

interface InferredNote {
  inferred: InferredDirectory;
  name: string;
  /** Where vasm reported the include it could not open, in the file being reported on. */
  range?: Range;
}

export default class DiagnosticProcessor {
  constructor(protected readonly ctx: Context) {}

  /**
   * Diagnostic messages provided by vasm assembling the current source file
   */
  async vasmDiagnostics(uri: string): Promise<Diagnostic[]> {
    const conf = this.ctx.config;
    if (!conf.vasm.provideDiagnostics) {
      return [];
    }

    // What to assemble. An include cannot be assembled on its own - it
    // depends on whatever pulls it in - so a program that includes it is
    // assembled instead, and its messages are reported against this file.
    const assembleUri = this.assemblyTarget(uri);
    if (!assembleUri) {
      return [];
    }

    // Full path of the file to assemble, and of the file being reported on
    const srcPath = URI.parse(assembleUri).fsPath;
    const targetPath = URI.parse(uri).fsPath;

    // Get absolute path of vasm executable if found
    let binPath: string | undefined;
    if (conf.vasm.binPath && !conf.vasm.preferWasm) {
      try {
        binPath = await which(conf.vasm.binPath);
      } catch (_) {
        this.ctx.logger.warn("Can't find vasm binary, using wasm");
      }
    }

    const { cwd, fileArg } = this.runContext(srcPath);

    const withRest = (extra: readonly string[]) => [
      // Custom args, and those that follow from the options in the main config
      // (include paths, processors, case), then any include paths guessed for
      // includes that were not found:
      ...assemblerArgs(conf),
      ...extra,
      // Filename of source file, relative to the directory it is run from, to
      // get relative paths in error messages:
      fileArg,
      // Don't actually need the output - just assembling to get error list
      "-o",
      join(tmpdir(), "a.out"),
    ];
    const options: cp.SpawnOptionsWithoutStdio = {
      cwd,
      stdio: "pipe",
    };

    // Directories guessed on an earlier run are used from the start, when they
    // are still there.
    const guessed = [...this.guessedDirectories].filter((dir) =>
      existsSync(dir),
    );
    const extra = guessed.map((dir) => `-I${dir}`);
    // And any the includes in the source say are needed, worked out from where
    // vasm looks and what the project has, so the first run need not fail.
    const predicted = await unresolvedIncludes(assembleUri, this.ctx);
    for (const found of inferDirectories(
      predicted.map((include) => include.name),
      this.ctx,
    ))
      if (!extra.includes(`-I${found.dir}`)) extra.push(`-I${found.dir}`);
    let output = await this.runVasm(binPath, withRest(extra), options);
    if (output === undefined) return [];

    // An include vasm cannot open may be named from a directory it was not run
    // in or given, which the config does not say. If the project has a file
    // ending in that path, the directory in front of it is where the include
    // is meant to be found, and vasm is run again with it as an include path.
    const found: InferredNote[] = [];
    for (
      let attempt = 0;
      attempt < MAX_INFERENCE_RUNS && conf.inferIncludePaths !== false;
      attempt++
    ) {
      const missing = /could not open <([^>]+)> for input/.exec(output)?.[1];
      if (!missing) break;
      const [inferred] = inferDirectories([missing], this.ctx).filter(
        (candidate) => !extra.includes(`-I${candidate.dir}`),
      );
      if (!inferred) break;

      const message = parseVasmMessages(output).find((m) => m.code === 13);
      const before = message && toDiagnostic(message, targetPath);
      extra.push(`-I${inferred.dir}`);
      const next = await this.runVasm(binPath, withRest(extra), options);
      if (next === undefined) break;
      output = next;
      this.guessedDirectories.add(inferred.dir);
      found.push({ inferred, name: missing, range: before?.range });
    }

    return [
      ...parseVasmOutput(output, targetPath),
      ...found.map((note) =>
        inferenceDiagnostic(note.inferred, note.name, note.range),
      ),
    ];
  }

  /**
   * The directory vasm is run in, and the name it is given the file by.
   *
   * vasm is run where the config says relative paths in the source resolve
   * from, else beside the file. The file is named relative to that so its
   * messages can be matched back to it; one outside it cannot be, so falls back
   * to its own directory.
   */
  private runContext(srcPath: string): { cwd: string; fileArg: string } {
    const cwd = vasmRunDirectory(
      this.ctx.config,
      this.ctx.workspaceFolders.map((f) => URI.parse(f.uri).fsPath),
      srcPath,
    );
    return {
      cwd,
      fileArg:
        cwd === dirname(srcPath) ? basename(srcPath) : relative(cwd, srcPath),
    };
  }

  /**
   * Notes on the includes in a file that vasm would not find but the project
   * has a file for. Worked out from the source and the file system alone, so it
   * needs no run of vasm and shows with vasm turned off.
   */
  includeDiagnostics(uri: string): Promise<Diagnostic[]> {
    if (this.ctx.config.inferIncludePaths === false) return Promise.resolve([]);
    return includeNotes(uri, this.assemblyTarget(uri) ?? uri, this.ctx);
  }

  /** Directories guessed for includes that were not found, kept for later runs. */
  private readonly guessedDirectories = new Set<string>();

  /** Everything vasm printed for one run, or undefined if it could not be run. */
  private runVasm(
    binPath: string | undefined,
    args: string[],
    options: cp.SpawnOptionsWithoutStdio,
  ): Promise<string | undefined> {
    // Execute vasm via binary or wasm
    const process = binPath
      ? cp.spawn(binPath, args, options)
      : cp.fork(wasmPath, args, options);

    let out = "";
    process.stdout?.on("data", (data) => (out += data));
    process.stderr?.on("data", (data) => (out += data));

    return new Promise((resolve) => {
      process.on("exit", () => resolve(out));
      process.on("error", () => {
        this.ctx.logger.error("Error assembling source file with vasm: " + out);
        resolve(undefined);
      });
    });
  }

  /**
   * The file to hand vasm in order to get messages about `uri`.
   *
   * Normally the file itself. An excluded one - `*.i` by default - is not
   * assembled directly, since an include depends on the context it is pulled
   * into and would report errors that only exist out of that context. A
   * program that includes it is assembled instead, so its own errors still
   * surface. Nothing is assembled when it belongs to no program.
   */
  private assemblyTarget(uri: string): string | undefined {
    if (!this.isExcluded(uri)) {
      return uri;
    }
    const entryPoint = getEntryPointsFor(uri, this.ctx).find(
      (candidate) => candidate !== uri && !this.isExcluded(candidate),
    );
    if (!entryPoint) {
      this.ctx.logger.info(
        `Skipping ${uri}: excluded, and no program includes it`,
      );
    }
    return entryPoint;
  }

  private isExcluded(uri: string): boolean {
    const path = URI.parse(uri).fsPath;
    const workspace =
      this.ctx.workspaceFolders.find((ws) => uri.startsWith(ws?.uri)) ??
      this.ctx.workspaceFolders[0];
    const wsRelative = relative(URI.parse(workspace?.uri)?.fsPath, path);
    return this.ctx.config.vasm.exclude.some((pattern) =>
      minimatch(wsRelative, pattern, { matchBase: true }),
    );
  }

  /**
   * Diagnostic messages generated from the parsed syntax tree
   */
  parserDiagnostics(parsed: ParsedFile, blocks: BlockStructure): Diagnostic[] {
    // Block errors sit alongside the line errors: an unterminated macro or a
    // stray `endc` is only visible once nesting has been worked out.
    const diagnostics = [...parsed.errors, ...blocks.errors].map(
      (error): Diagnostic => ({
        range: locationAsRange(error.loc),
        message: error.hint ? `${error.message}. ${error.hint}` : error.message,
        severity: DiagnosticSeverity.Error,
        source: "m68k",
        code: error.code,
      }),
    );

    // No need for this if vasm is configured
    if (!this.ctx.config.vasm.provideDiagnostics) {
      for (const line of parsed.lines) {
        const { mnemonic } = line;
        if (mnemonic?.type !== "instruction") {
          continue;
        }
        const doc = instructionDocs[mnemonic.instruction.toLowerCase()];
        if (
          doc &&
          !this.ctx.config.processors.some((proc) => doc.procs[proc])
        ) {
          diagnostics.push({
            range: locationAsRange(mnemonic.loc),
            message: "Unsupported on selected processor(s)",
            severity: DiagnosticSeverity.Error,
            source: "lsp",
          });
        }
      }
    }

    return diagnostics;
  }
}

// Map vasm error types to DiagnosticSeverity
const vasmLevels = {
  message: DiagnosticSeverity.Information,
  warning: DiagnosticSeverity.Warning,
  error: DiagnosticSeverity.Error,
};

/**
 * Parse CLI output from vasm into diagnostic array
 */
export function parseVasmOutput(
  output: string,
  targetFile?: string,
): Diagnostic[] {
  return parseVasmMessages(output)
    .map((message) => toDiagnostic(message, targetFile))
    .filter((d): d is Diagnostic => d !== undefined);
}

/** One vasm message, before it is tied to a particular file. */
interface VasmMessage {
  code: number;
  severity: DiagnosticSeverity;
  /** The message body, without the "error N in line L of F:" preamble. */
  body: string;
  /** The preamble, kept for messages that carry an include trace. */
  header: string;
  /** Where vasm says the problem is. Absent for messages with no location. */
  location?: { file: string; line: number };
  /** How that location was reached, innermost first. */
  trace: { file: string; line: number; text: string }[];
  /** The offending source line, as echoed back after `>`. */
  sourceLine?: string;
}

const locationPattern =
  /(message|warning|error) (\d+) in line (\d+) of "?([^":]+)"?: (.+)/;
const noLocationPattern = /(message|warning|error) (\d+): (.+)/;
const tracePattern = /from line (\d+) of "?([^":]+)"?/;

function parseVasmMessages(output: string): VasmMessage[] {
  const messages: VasmMessage[] = [];
  let current: VasmMessage | undefined;

  for (const lineText of output.split("\n")) {
    const located = lineText.match(locationPattern);
    if (located) {
      current = {
        code: Number(located[2]),
        severity: vasmLevels[located[1] as keyof typeof vasmLevels],
        body: located[5],
        header: lineText,
        location: { file: located[4], line: Number(located[3]) },
        trace: [],
      };
      messages.push(current);
      continue;
    }

    const unlocated = lineText.match(noLocationPattern);
    if (unlocated) {
      current = {
        code: Number(unlocated[2]),
        severity: vasmLevels[unlocated[1] as keyof typeof vasmLevels],
        body: unlocated[3],
        header: lineText,
        trace: [],
      };
      messages.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const trace = lineText.match(tracePattern);
    if (trace) {
      current.trace.push({
        file: trace[2],
        line: Number(trace[1]),
        text: lineText,
      });
      continue;
    }

    const source = lineText.match(/^>(.+)/);
    if (source) {
      current.sourceLine = source[1];
    }
  }

  return messages;
}

/** Does a path vasm printed refer to the file being reported on? */
function isSameFile(reported: string, target: string): boolean {
  return reported === target || target.endsWith("/" + reported);
}

/**
 * Place a message in one file.
 *
 * A message reached through includes has a position in each file of the chain:
 * the line in the file that actually holds the problem, and the line of the
 * include that pulled it in, at every level above. `targetFile` chooses which
 * of those to report, so the same vasm run can describe the error for the file
 * that has it and for the file being assembled.
 *
 * Without a target the outermost position is used, which is the file vasm was
 * pointed at.
 */
function toDiagnostic(
  message: VasmMessage,
  targetFile?: string,
): Diagnostic | undefined {
  const { location, trace } = message;

  // Positions this message has, innermost first.
  const positions = location
    ? [{ ...location, text: undefined }, ...trace]
    : [];

  let index = positions.length - 1;
  if (targetFile !== undefined && positions.length) {
    index = positions.findIndex((p) => isSameFile(p.file, targetFile));
    if (index === -1) {
      return undefined; // Belongs to some other file entirely
    }
  }

  const line = positions.length ? positions[index].line - 1 : 0;

  // Reporting at the origin needs no explanation. Reporting further up the
  // include chain does, so the preamble and the steps below the reported one
  // are kept, which is how the path to the problem stays visible.
  const context = positions
    .slice(1, index)
    .map((p) => p.text)
    .filter((t): t is string => t !== undefined);
  // index is -1 when the message has no location at all.
  const text =
    index <= 0 ? message.body : [message.header, ...context].join("\n");

  const start = message.sourceLine
    ? (message.sourceLine.match(/[^\s]/)?.index ?? 0)
    : 0;
  const end = message.sourceLine ? message.sourceLine.length : 0;

  return {
    range: { start: { line, character: start }, end: { line, character: end } },
    code: message.code,
    source: "vasm",
    message: text,
    severity: message.severity,
  };
}
