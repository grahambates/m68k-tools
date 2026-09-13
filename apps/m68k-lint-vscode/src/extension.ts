import { join } from "node:path";
import { workspace, type ExtensionContext } from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
  const module = context.asAbsolutePath(join("out", "server.js"));

  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6019"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    // `vasmmot` is the language id used by the Amiga Assembly extension, so
    // sources opened under either that or m68k-lsp's `m68k` get linted.
    documentSelector: [
      { scheme: "file", language: "m68k" },
      { scheme: "file", language: "vasmmot" },
    ],
    synchronize: {
      // The server rebuilds its config and symbol caches from these. Includes
      // matter as much as sources: a constant's value lives in one, and every
      // file that uses it is affected when it changes.
      fileEvents: [
        workspace.createFileSystemWatcher(
          "**/{m68k-lint.json,.m68klintrc.json}",
        ),
        workspace.createFileSystemWatcher("**/*.{s,S,i,I,inc,asm,ASM,a68,h}"),
      ],
    },
  };

  client = new LanguageClient(
    "m68kLint",
    "M68k Lint",
    serverOptions,
    clientOptions,
  );
  context.subscriptions.push(client);
  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
