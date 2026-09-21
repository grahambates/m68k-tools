import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(here, "..", "out", "server.js");

export const fixture = (relative) => resolve(here, "fixtures", relative);

/**
 * A minimal LSP client, enough to drive the server the way a real editor does.
 *
 * The server is exercised over stdio as a separate process rather than by
 * importing its modules, because the bugs worth catching here live in the
 * protocol surface: capabilities it declares, notifications it subscribes to,
 * and the order it does things in during initialize.
 */
export class TestClient {
  #child;
  #buffer = Buffer.alloc(0);
  #waiters = [];
  #nextId = 1;

  /**
   * @param {object} options
   * @param {object} [options.settings] Served in reply to workspace/configuration.
   * @param {boolean} [options.workspaceFolders] Advertise workspace-folder support.
   * @param {boolean} [options.configuration] Advertise configuration support.
   * @param {number} [options.registerDelayMs] Stall the reply to client/registerCapability.
   * @param {boolean} [options.createFiles] Advertise support for creating a file in an edit.
   * @param {boolean} [options.resolveCodeActionEdits] Advertise that a code action's edit can be resolved later.
   */
  constructor(options = {}) {
    this.options = {
      settings: {
        enable: true,
        run: "onType",
        defaults: {},
        quickFix: { conditional: false, annotate: "obfuscated" },
      },
      workspaceFolders: true,
      configuration: true,
      registerDelayMs: 0,
      ...options,
    };
    this.#child = spawn(process.execPath, [SERVER, "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.stderr = "";
    this.#child.stderr.on("data", (chunk) => (this.stderr += chunk.toString()));
    this.#child.stdout.on("data", (chunk) => this.#receive(chunk));
  }

  #receive(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const headerEnd = this.#buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = Number(
        /Content-Length: (\d+)/.exec(
          this.#buffer.subarray(0, headerEnd).toString(),
        )?.[1],
      );
      if (this.#buffer.length < headerEnd + 4 + length) return;
      const message = JSON.parse(
        this.#buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString(),
      );
      this.#buffer = this.#buffer.subarray(headerEnd + 4 + length);
      this.#dispatch(message);
    }
  }

  /** Every diagnostic publication so far, in order, for a test that counts them. */
  published = [];

  #dispatch(message) {
    if (message.method === "textDocument/publishDiagnostics")
      this.published.push(message.params);
    // Server-to-client requests are answered here, before anything can wait on
    // them: their ids share a space with nothing, and a waiter matching on id
    // would otherwise resolve against the server's own request.
    if (message.method === "client/registerCapability") {
      const reply = () => this.#send({ id: message.id, result: null });
      if (this.options.registerDelayMs)
        setTimeout(reply, this.options.registerDelayMs);
      else reply();
      return;
    }
    if (message.method === "workspace/configuration") {
      this.#send({
        id: message.id,
        result: message.params.items.map(() => this.options.settings),
      });
      return;
    }
    for (let i = this.#waiters.length - 1; i >= 0; i--) {
      if (this.#waiters[i].match(message))
        this.#waiters.splice(i, 1)[0].resolve(message);
    }
  }

  #send(message) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.#child.stdin.write(
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  }

  notify(method, params) {
    this.#send({ method, params });
  }

  wait(match, label, timeoutMs = 20000) {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        timeoutMs,
      );
      this.#waiters.push({
        match,
        resolve: (message) => {
          clearTimeout(timer);
          resolvePromise(message);
        },
      });
    });
  }

  request(method, params) {
    const id = this.#nextId++;
    const response = this.wait(
      (message) => message.id === id && !message.method,
      method,
    );
    this.#send({ id, method, params });
    return response;
  }

  async initialize(root) {
    const rootUri = pathToFileURL(root).toString();
    const workspace = { configuration: this.options.configuration };
    if (this.options.workspaceFolders) workspace.workspaceFolders = true;
    if (this.options.createFiles)
      workspace.workspaceEdit = {
        documentChanges: true,
        resourceOperations: ["create"],
      };

    const result = await this.request("initialize", {
      processId: process.pid,
      rootUri,
      capabilities: {
        workspace,
        textDocument: {
          codeAction: this.options.resolveCodeActionEdits
            ? { resolveSupport: { properties: ["edit"] } }
            : {},
        },
      },
      workspaceFolders: this.options.workspaceFolders
        ? [{ uri: rootUri, name: "fixture" }]
        : null,
    });
    this.notify("initialized", {});
    // The capabilities themselves, not the InitializeResult wrapping them:
    // assertions like "does not declare hoverProvider" pass trivially against
    // the wrapper, which is exactly the regression this guards.
    return result.result.capabilities;
  }

  /** Opens a file and resolves with the diagnostics published for it. */
  async open(path, languageId = "m68k") {
    const uri = pathToFileURL(path).toString();
    const published = this.wait(
      (message) =>
        message.method === "textDocument/publishDiagnostics" &&
        message.params.uri === uri,
      `diagnostics for ${path}`,
    );
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: readFileSync(path, "utf8"),
      },
    });
    return { uri, diagnostics: (await published).params.diagnostics };
  }

  /** @param {string[]} [only] The kinds of action asked for, as a client filtering by kind sends. */
  async codeActions(uri, line, only) {
    const result = await this.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line, character: 0 }, end: { line, character: 0 } },
      context: { diagnostics: [], ...(only ? { only } : {}) },
    });
    return result.result;
  }

  /** Asks the server to fill in a code action it offered without its edit. */
  async resolveCodeAction(action) {
    return (await this.request("codeAction/resolve", action)).result;
  }

  /** Resolves once `count` publications for `uri` have arrived, counting from the start. */
  async publishedFor(uri, count, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (this.published.filter((p) => p.uri === uri).length < count) {
      if (Date.now() > deadline)
        throw new Error(
          `timed out waiting for publication ${count} for ${uri}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.published.filter((p) => p.uri === uri);
  }

  /** Replaces the whole text of an open document. */
  change(uri, version, text) {
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  stop() {
    this.#child.kill();
  }
}

/** The edits one action makes to the document it targets. */
export const editsOf = (action, uri) => action.edit?.changes?.[uri] ?? [];
