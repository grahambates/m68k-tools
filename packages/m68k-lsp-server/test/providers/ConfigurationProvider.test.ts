import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type * as lsp from "vscode-languageserver";
import { createContext } from "../../src/context";
import { defaultConfig } from "../../src/config";
import ConfigurationProvider from "../../src/providers/ConfigurationProvider";
import { NullLogger } from "../helpers";

describe("ConfigurationProvider", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-config-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads workspace overrides independently of the working directory", async () => {
    await writeFile(
      join(dir, ".m68krc.json"),
      JSON.stringify({ processors: ["mc68020"] }),
    );
    const ctx = await createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "config" }],
      new NullLogger(),
      {} as lsp.Connection,
      {},
    );
    new ConfigurationProvider(ctx);
    expect(ctx.config.processors).toEqual(["mc68020"]);
  });

  it("finds a config above the workspace folder", async () => {
    await writeFile(
      join(dir, ".m68krc.json"),
      JSON.stringify({ processors: ["mc68030"] }),
    );
    await mkdir(join(dir, "game"));
    const ctx = await createContext(
      [{ uri: pathToFileURL(join(dir, "game")).toString(), name: "game" }],
      new NullLogger(),
      {} as lsp.Connection,
      {},
    );
    new ConfigurationProvider(ctx);
    expect(ctx.config.processors).toEqual(["mc68030"]);
  });

  it("takes relative include paths from the config file", async () => {
    await writeFile(
      join(dir, ".m68krc.json"),
      JSON.stringify({ includePaths: ["inc", "/abs"] }),
    );
    await mkdir(join(dir, "game"));
    const ctx = await createContext(
      [{ uri: pathToFileURL(join(dir, "game")).toString(), name: "game" }],
      new NullLogger(),
      {} as lsp.Connection,
      {},
    );
    new ConfigurationProvider(ctx);
    expect(ctx.config.includePaths).toEqual([join(dir, "inc"), "/abs"]);
  });

  it("resets removed client settings while retaining workspace overrides", async () => {
    await writeFile(
      join(dir, ".m68krc.json"),
      JSON.stringify({ processors: ["mc68020"] }),
    );
    const getConfiguration = vi.fn().mockResolvedValue({});
    const ctx = await createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "config" }],
      new NullLogger(),
      { workspace: { getConfiguration } } as unknown as lsp.Connection,
      {
        includePaths: ["old-include"],
        format: {
          ...defaultConfig.format,
          align: { ...defaultConfig.format.align, tabSize: 4 },
        },
      },
    );
    const provider = new ConfigurationProvider(ctx);
    await provider.onDidChangeConfiguration();
    expect(ctx.config.includePaths).toEqual(defaultConfig.includePaths);
    expect(ctx.config.format.align?.tabSize).toBe(
      defaultConfig.format.align?.tabSize,
    );
    expect(ctx.config.processors).toEqual(["mc68020"]);
  });
});
