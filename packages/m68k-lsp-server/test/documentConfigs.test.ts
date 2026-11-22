import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type * as lsp from "vscode-languageserver";
import { createContext } from "../src/context";
import { configFor } from "../src/documentConfigs";
import FileOperationsProvider from "../src/providers/FileOperationsProvider";
import { NullLogger } from "./helpers";

describe("configFor", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-document-config-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (path: string, value: unknown) => {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(
      join(dir, path),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const uri = (path: string) => pathToFileURL(join(dir, path)).toString();
  const context = (logger: lsp.Logger = new NullLogger()) =>
    createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "workspace" }],
      logger,
      {} as lsp.Connection,
      {},
    );

  // Issue #25: the workspace folder was a parent of the project, and the
  // project's config was never read.
  it("reads a config below the workspace folder", async () => {
    await write("demos/intro/.m68krc.json", {
      processors: ["mc68020"],
      vasm: { binPath: "/opt/vasm/vasmm68k_mot" },
    });
    const ctx = await context();
    const config = configFor(ctx, uri("demos/intro/src/main.s"));
    expect(config.processors).toEqual(["mc68020"]);
    expect(config.vasm.binPath).toBe("/opt/vasm/vasmm68k_mot");
  });

  it("goes by the nearest config to each document", async () => {
    await write(".m68krc.json", { processors: ["mc68000"] });
    await write("demos/intro/.m68krc", { processors: ["mc68030"] });
    const ctx = await context();
    expect(configFor(ctx, uri("main.s")).processors).toEqual(["mc68000"]);
    expect(configFor(ctx, uri("demos/main.s")).processors).toEqual(["mc68000"]);
    expect(configFor(ctx, uri("demos/intro/main.s")).processors).toEqual([
      "mc68030",
    ]);
  });

  it("takes relative paths from the config file's directory", async () => {
    await write("demos/intro/.m68krc.json", {
      includePaths: ["include"],
      sourceRoot: "src",
    });
    const ctx = await context();
    const config = configFor(ctx, uri("demos/intro/src/deep/main.s"));
    expect(config.includePaths).toEqual([join(dir, "demos/intro/include")]);
    expect(config.sourceRoot).toBe(join(dir, "demos/intro/src"));
  });

  it("lays a config file over the client's settings", async () => {
    await write("demos/.m68krc.json", { processors: ["mc68020"] });
    const ctx = await context();
    ctx.documentConfigs.reset({
      ...ctx.config,
      inlayHints: { enabled: false },
    });
    const config = configFor(ctx, uri("demos/main.s"));
    expect(config.processors).toEqual(["mc68020"]);
    expect(config.inlayHints.enabled).toBe(false);
  });

  it("is the workspace config where no file applies", async () => {
    const ctx = await context();
    expect(configFor(ctx, uri("main.s"))).toBe(ctx.config);
    expect(configFor(ctx, "untitled:Untitled-1")).toBe(ctx.config);
  });

  it("is the workspace config when the file cannot be read", async () => {
    await write("demos/.m68krc.json", "{ not json");
    const errors: string[] = [];
    const logger: lsp.Logger = {
      ...new NullLogger(),
      info: () => undefined,
      warn: () => undefined,
      log: () => undefined,
      error: (message: string) => void errors.push(message),
    };
    const ctx = await context(logger);
    expect(configFor(ctx, uri("demos/main.s"))).toBe(ctx.config);
    expect(errors).toEqual([
      expect.stringContaining(join(dir, "demos/.m68krc.json")),
    ]);
  });

  it("sees a changed or new config file once cleared", async () => {
    const ctx = await context();
    expect(configFor(ctx, uri("demos/main.s"))).toBe(ctx.config);

    await write("demos/.m68krc.json", { processors: ["mc68020"] });
    // Found and loaded once per directory, not on every request.
    expect(configFor(ctx, uri("demos/main.s"))).toBe(ctx.config);
    ctx.documentConfigs.clear();
    expect(configFor(ctx, uri("demos/main.s")).processors).toEqual(["mc68020"]);

    await write("demos/.m68krc.json", { processors: ["mc68040"] });
    ctx.documentConfigs.clear();
    expect(configFor(ctx, uri("demos/main.s")).processors).toEqual(["mc68040"]);
  });

  it("sees a config file the editor reports as changed", async () => {
    const ctx = await context();
    expect(configFor(ctx, uri("demos/main.s"))).toBe(ctx.config);

    await write("demos/.m68krc.json", { processors: ["mc68020"] });
    await new FileOperationsProvider(ctx).onDidChangeWatchedFiles({
      changes: [{ uri: uri("demos/.m68krc.json"), type: 1 }],
    });
    expect(configFor(ctx, uri("demos/main.s")).processors).toEqual(["mc68020"]);
  });
});
