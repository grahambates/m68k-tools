import {
  CodeActionKind,
  DidChangeConfigurationNotification,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
  type CodeActionParams,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { lintSource, needsProjectReferences, type Diagnostic } from "m68k-lint";
import { ConfigResolver, defaultSettings, type Settings } from "./config.js";
import {
  DIAGNOSTIC_SOURCE,
  diagnosticRange,
  toLspDiagnostic,
} from "./diagnostics.js";
import { codeActionsFor, type ActionOptions } from "./codeActions.js";
import { ignoreFileAction } from "./ignoreFile.js";
import { ProjectIndexCache } from "./projectIndex.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const configs = new ConfigResolver();
const indexes = new ProjectIndexCache();

let workspaceRoots: string[] = [];
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
/** Whether an edit may create a file, which "ignore this file" needs when there is no config. */
let canCreateFiles = false;

/**
 * Resolves once the first settings pull has finished.
 *
 * Clients send `initialized` and then open their documents immediately, so
 * without this the first lint of every file races the settings request and
 * runs on defaults — publishing findings for a user who has the server turned
 * off, or withholding conditional fixes they asked for.
 */
let markSettingsReady: () => void = () => {};
const settingsReady = new Promise<void>((resolve) => {
  markSettingsReady = resolve;
});

function rootFor(fsPath: string): string | undefined {
  // The longest matching root wins, so a nested folder added to the workspace
  // indexes as itself rather than as part of its parent.
  return workspaceRoots
    .filter((root) => fsPath.startsWith(root))
    .sort((a, b) => b.length - a.length)[0];
}

/** Unsaved editor text, so the index sees what the user sees. */
function openDocumentText(): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const document of documents.all()) {
    const uri = URI.parse(document.uri);
    if (uri.scheme === "file") overrides.set(uri.fsPath, document.getText());
  }
  return overrides;
}

async function lintDocument(
  document: TextDocument,
): Promise<Diagnostic[] | undefined> {
  const uri = URI.parse(document.uri);
  if (uri.scheme !== "file") return undefined;

  // A file the project leaves out of linting gets no findings, the same as on
  // the command line. Its symbols are still indexed for everything else.
  if (await configs.isIgnored(uri.fsPath)) return [];

  const { config, error } = await configs.resolve(uri.fsPath);
  if (error) connection.console.warn(`m68k-lint: ${error}`);

  const root =
    config.projectSymbols === false ? undefined : rootFor(uri.fsPath);
  const projectIndex = root
    ? await indexes.get(
        root,
        openDocumentText(),
        needsProjectReferences(config),
      )
    : undefined;

  return lintSource(
    document.getText(),
    config,
    undefined,
    projectIndex?.symbols,
    projectIndex?.references,
  );
}

async function validate(document: TextDocument): Promise<void> {
  await settingsReady;
  if (!configs.getSettings().enable) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }
  try {
    const diagnostics = await lintDocument(document);
    if (!diagnostics) return;
    connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: diagnostics.map((diagnostic) =>
        toLspDiagnostic(diagnostic, document),
      ),
    });
  } catch (error) {
    // A parse or rule failure on one document must not take the server down or
    // leave stale squiggles behind.
    connection.console.error(
      `m68k-lint failed on ${document.uri}: ${String(error)}`,
    );
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  }
}

/**
 * Coalesces keystrokes per document.
 *
 * Linting measures 68000 impact with 68kcounter, which is not free on a large
 * file, and every intermediate keystroke produces a half-typed instruction
 * nobody wants diagnostics for.
 */
const pending = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 300;

function scheduleValidate(document: TextDocument): void {
  const existing = pending.get(document.uri);
  if (existing) clearTimeout(existing);
  pending.set(
    document.uri,
    setTimeout(() => {
      pending.delete(document.uri);
      void validate(document);
    }, DEBOUNCE_MS),
  );
}

function validateAll(): void {
  for (const document of documents.all()) void validate(document);
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability = Boolean(
    params.capabilities.workspace?.configuration,
  );
  hasWorkspaceFolderCapability = Boolean(
    params.capabilities.workspace?.workspaceFolders,
  );
  const workspaceEdit = params.capabilities.workspace?.workspaceEdit;
  canCreateFiles = Boolean(
    workspaceEdit?.documentChanges &&
    workspaceEdit.resourceOperations?.includes("create"),
  );
  // Nothing to wait for when the client cannot serve settings at all.
  if (!hasConfigurationCapability) markSettingsReady();

  const folders = params.workspaceFolders ?? [];
  workspaceRoots = folders
    .map((folder) => URI.parse(folder.uri))
    .filter((uri) => uri.scheme === "file")
    .map((uri) => uri.fsPath);
  if (!workspaceRoots.length && params.rootUri) {
    const uri = URI.parse(params.rootUri);
    if (uri.scheme === "file") workspaceRoots = [uri.fsPath];
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Deliberately narrow. This server runs alongside a full m68k language
      // server, and anything it declares here that the other also provides
      // turns into a formatter prompt or a definition picker for the user.
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.SourceFixAll],
        resolveProvider: false,
      },
      workspace: {
        workspaceFolders: { supported: true, changeNotifications: true },
      },
    },
  };
});

connection.onInitialized(async () => {
  // Settings first, and never behind the registration await. Registration is a
  // request the client has to answer, and a client that is slow or silent
  // there would otherwise leave the server running on defaults forever.
  await refreshSettings();
  markSettingsReady();

  if (hasConfigurationCapability) {
    connection.client
      .register(DidChangeConfigurationNotification.type, undefined)
      .catch((error: unknown) =>
        connection.console.warn(`m68k-lint: ${String(error)}`),
      );
  }

  // Subscribing without this throws: the notification only exists if the
  // client said it sends it, and plenty of non-VS Code clients do not.
  if (!hasWorkspaceFolderCapability) return;
  connection.workspace.onDidChangeWorkspaceFolders((event) => {
    const removed = new Set(
      event.removed.map((folder) => URI.parse(folder.uri).fsPath),
    );
    workspaceRoots = workspaceRoots.filter((root) => !removed.has(root));
    for (const folder of event.added) {
      const uri = URI.parse(folder.uri);
      if (uri.scheme === "file") workspaceRoots.push(uri.fsPath);
    }
    indexes.clear();
    configs.clear();
    validateAll();
  });
});

async function refreshSettings(): Promise<void> {
  if (!hasConfigurationCapability) return;
  try {
    const settings = (await connection.workspace.getConfiguration(
      "m68kLint",
    )) as Partial<Settings> | null;
    configs.updateSettings({ ...defaultSettings, ...(settings ?? {}) });
  } catch {
    configs.updateSettings(defaultSettings);
  }
}

connection.onDidChangeConfiguration(async () => {
  await refreshSettings();
  validateAll();
});

/**
 * A changed config file or include changes results for files that were not
 * themselves touched, so both caches go and everything open is re-linted.
 */
connection.onDidChangeWatchedFiles(() => {
  configs.clear();
  indexes.clear();
  validateAll();
});

documents.onDidOpen((event) => void validate(event.document));

documents.onDidChangeContent((event) => {
  if (configs.getSettings().run === "onType") scheduleValidate(event.document);
});

documents.onDidSave((event) => {
  // A save can change what other open files resolve, so the index goes with it.
  indexes.clear();
  void validate(event.document);
});

documents.onDidClose((event) => {
  const timer = pending.get(event.document.uri);
  if (timer) clearTimeout(timer);
  pending.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onCodeAction(async (params: CodeActionParams) => {
  await settingsReady;
  const document = documents.get(params.textDocument.uri);
  if (!document || !configs.getSettings().enable) return [];

  const diagnostics = await lintDocument(document);
  if (!diagnostics?.length) return [];

  // Match on our own findings for the requested range rather than trusting the
  // diagnostics the client echoed back, which may predate unsaved edits.
  const requested = params.range;
  const selected = diagnostics.filter((diagnostic) => {
    const range = diagnosticRange(diagnostic, document);
    return (
      (diagnostic.span ? diagnostic.span.startLine - 1 : range.start.line) <=
        requested.end.line &&
      (diagnostic.span ? diagnostic.span.endLine - 1 : range.end.line) >=
        requested.start.line
    );
  });
  if (
    !selected.length &&
    !params.context.only?.includes(CodeActionKind.SourceFixAll)
  )
    return [];

  const uri = URI.parse(document.uri);
  const { config } = await configs.resolve(uri.fsPath);
  const root =
    config.projectSymbols === false ? undefined : rootFor(uri.fsPath);
  const projectIndex = root
    ? await indexes.get(
        root,
        openDocumentText(),
        needsProjectReferences(config),
      )
    : undefined;

  const resolved = await configs.resolve(uri.fsPath);
  const ignoreFile = resolved.error
    ? undefined
    : await ignoreFileAction({
        fsPath: uri.fsPath,
        configPath: resolved.configPath,
        root: rootFor(uri.fsPath),
        canCreateFiles,
        openText: (configUri) => documents.get(configUri)?.getText(),
      });

  const settings = configs.getSettings();
  const options: ActionOptions = {
    ignoreFile,
    conditional: settings.quickFix.conditional,
    annotate: config.fixAnnotate ?? "obfuscated",
    lint: (text) =>
      lintSource(
        text,
        config,
        undefined,
        projectIndex?.symbols,
        projectIndex?.references,
      ),
  };

  const actions = codeActionsFor(
    document,
    document.getText(),
    diagnostics,
    selected,
    options,
  );
  const only = params.context.only;
  return only
    ? actions.filter((action) => action.kind && only.includes(action.kind))
    : actions;
});

export { DIAGNOSTIC_SOURCE };

documents.listen(connection);
connection.listen();
