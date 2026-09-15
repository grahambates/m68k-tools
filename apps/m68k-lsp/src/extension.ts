import { remappingHighlights } from "./remappingHighlights";
import {
  RegisterRangesRequest,
  RegisterUsageRequest,
  RegisterSwapRequest,
  RegisterRemapRequest,
  RoutineRangeRequest,
  IndexChangedNotification,
} from "@m68k-lsp/protocol";
import type {
  RegisterUsageResult,
  RoutineRangeResult,
  Range as ProtocolRange,
  TextEdit,
} from "@m68k-lsp/protocol";
import * as path from "path";
import {
  DecorationRangeBehavior,
  ThemeColor,
  type DecorationOptions,
  type ExtensionContext,
  type QuickPickItem,
  QuickPickItemKind,
  Range,
  type TextEditor,
  commands,
  window,
  workspace,
} from "vscode";

import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import {
  type RegisterRemappingModel,
  type RegisterRemappingResult,
  RegisterRemappingView,
} from "./RegisterRemappingView";

let client: LanguageClient;

interface RemappingContext {
  isCurrent: () => boolean;
  uri: string;
  range: ProtocolRange;
  documentVersion: number;
}

type RegisterCommandScope = Pick<RoutineRangeResult, "range"> &
  Partial<Pick<RoutineRangeResult, "label">>;

const generalPurposeRegisters = [
  "d0",
  "d1",
  "d2",
  "d3",
  "d4",
  "d5",
  "d6",
  "d7",
  "a0",
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
  "a7",
];

const registerColours = new Map([
  ["d0", "#e06c75"],
  ["d1", "#d19a66"],
  ["d2", "#e5c07b"],
  ["d3", "#98c379"],
  ["d4", "#56b6c2"],
  ["d5", "#61afef"],
  ["d6", "#c678dd"],
  ["d7", "#be5046"],
  ["a0", "#f06c9b"],
  ["a1", "#f5a97f"],
  ["a2", "#f2cc8f"],
  ["a3", "#a8d08d"],
  ["a4", "#78c4c4"],
  ["a5", "#7aa2f7"],
  ["a6", "#b48ead"],
  ["a7", "#d08770"],
  ["sp", "#ff7ab2"],
  ["pc", "#ff9e64"],
  ["sr", "#e0af68"],
  ["ccr", "#9ece6a"],
  ["usp", "#2ac3de"],
  ["ssp", "#7dcfff"],
  ["vbr", "#bb9af7"],
  ["sfc", "#f7768e"],
  ["dfc", "#ff9e64"],
  ["cacr", "#e0af68"],
  ["caar", "#9ece6a"],
  ["fp0", "#2ac3de"],
  ["fp1", "#7dcfff"],
  ["fp2", "#7aa2f7"],
  ["fp3", "#bb9af7"],
  ["fp4", "#f7768e"],
  ["fp5", "#ff9e64"],
  ["fp6", "#e0af68"],
  ["fp7", "#9ece6a"],
  ["fpcr", "#2ac3de"],
  ["fpsr", "#7dcfff"],
  ["fpiar", "#7aa2f7"],
]);

export function activate(context: ExtensionContext): void {
  const decorations = new Map(
    Array.from(registerColours, ([register, color]) => [
      register,
      window.createTextEditorDecorationType({
        color,
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
      }),
    ]),
  );
  let enabled = workspace
    .getConfiguration("m68k.registerColours")
    .get<boolean>("enabled", true);
  let clientReady = false;
  let remappingContext: RemappingContext | undefined;
  let modelGeneration = 0;
  let previewGeneration = 0;
  let previewUsage: RegisterUsageResult | undefined;
  const previewMark = window.createTextEditorDecorationType({
    border: "1px solid",
    borderColor: new ThemeColor("editorInfo.foreground"),
    rangeBehavior: DecorationRangeBehavior.ClosedClosed,
  });
  const previewWarning = window.createTextEditorDecorationType({
    border: "1px solid",
    borderColor: new ThemeColor("editorWarning.foreground"),
    rangeBehavior: DecorationRangeBehavior.ClosedClosed,
  });
  const usageHighlight = window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new ThemeColor("editor.wordHighlightBackground"),
    rangeBehavior: DecorationRangeBehavior.ClosedClosed,
  });
  const highlightUsage = (register?: string) => {
    const snapshot = remappingContext;
    const references =
      register && snapshot?.isCurrent()
        ? (previewUsage?.registers.find((usage) => usage.name === register)
            ?.references ?? [])
        : [];
    // Multiple operands on one line must not stack translucent backgrounds.
    const lines = new Set(references.map(({ range }) => range.start.line));
    const ranges = [...lines].map((line) => new Range(line, 0, line, 0));
    for (const editor of window.visibleTextEditors) {
      editor.setDecorations(
        usageHighlight,
        editor.document.uri.toString() === snapshot?.uri ? ranges : [],
      );
    }
  };
  context.subscriptions.push(usageHighlight);
  const clearPreview = () => {
    previewGeneration++;
    for (const editor of window.visibleTextEditors) {
      editor.setDecorations(previewMark, []);
      editor.setDecorations(previewWarning, []);
    }
  };
  context.subscriptions.push(previewMark, previewWarning);

  const decorationGenerations = new WeakMap<TextEditor, number>();

  const clearDecorations = (editor: TextEditor) => {
    for (const decoration of decorations.values()) {
      editor.setDecorations(decoration, []);
    }
  };

  const applyDecorations = async (editor: TextEditor) => {
    const generation = (decorationGenerations.get(editor) ?? 0) + 1;
    decorationGenerations.set(editor, generation);
    if (!clientReady) return;
    const version = editor.document.version;
    if (!enabled) {
      clearDecorations(editor);
      return;
    }

    const ranges = await client.sendRequest(RegisterRangesRequest, {
      uri: editor.document.uri.toString(),
    });
    if (
      !enabled ||
      editor.document.version !== version ||
      decorationGenerations.get(editor) !== generation
    )
      return;
    for (const [register, decoration] of decorations) {
      editor.setDecorations(
        decoration,
        (ranges[register] ?? []).map(toEditorRange),
      );
    }
  };

  const refresh = () => {
    for (const editor of window.visibleTextEditors) {
      if (
        editor.document.languageId === "m68k" ||
        editor.document.languageId === "vasmmot"
      ) {
        void applyDecorations(editor);
      }
    }
  };

  const loadRemappingModel = async (
    isCurrent = () => true,
  ): Promise<RegisterRemappingModel | undefined> => {
    clearPreview();
    previewUsage = undefined;
    const generation = ++modelGeneration;
    remappingContext = undefined;
    if (!clientReady) {
      return;
    }
    const editor = window.activeTextEditor;
    if (!editor || !isM68kEditor(editor)) {
      remappingContext = undefined;
      return;
    }
    const selection = editor.selection;
    const version = editor.document.version;
    const stillCurrent = () =>
      isCurrent() &&
      modelGeneration === generation &&
      window.activeTextEditor === editor &&
      editor.document.version === version &&
      editor.selection.isEqual(selection);
    const scope = await registerCommandScope(editor, false);
    if (!stillCurrent() || !scope) {
      return;
    }
    const { range } = scope;
    const usage = await client.sendRequest(RegisterUsageRequest, {
      textDocument: { uri: editor.document.uri.toString() },
      range,
      position: selection.isEmpty ? selection.active : undefined,
    });
    if (!stillCurrent() || !usage || usage.documentVersion !== version) {
      return;
    }
    previewUsage = usage;
    remappingContext = {
      isCurrent: stillCurrent,
      uri: editor.document.uri.toString(),
      range,
      documentVersion: usage.documentVersion,
    };
    return {
      scope: `${scope.label ? `${scope.label} · ` : ""}lines ${range.start.line + 1}-${range.end.line + 1}`,
      registers: usage.registers,
      colors: enabled
        ? Object.fromEntries(
            generalPurposeRegisters.map((register) => [
              register,
              registerColours.get(register),
            ]),
          )
        : undefined,
    };
  };

  const applyRemappings = async (
    mappings: Record<string, string>,
  ): Promise<RegisterRemappingResult> => {
    const editor = window.activeTextEditor;
    const snapshot = remappingContext;
    if (
      !editor ||
      !snapshot ||
      !snapshot.isCurrent() ||
      editor.document.uri.toString() !== snapshot.uri ||
      editor.document.version !== snapshot.documentVersion
    ) {
      return {
        ok: false,
        message: "The editor scope changed. Refresh and try again.",
      };
    }
    const planned = await client.sendRequest(RegisterRemapRequest, {
      textDocument: { uri: snapshot.uri },
      documentVersion: snapshot.documentVersion,
      range: snapshot.range,
      mappings,
    });
    if (!planned) {
      return { ok: false, message: "Register analysis is unavailable." };
    }
    if (planned.error === "mapping-conflict") {
      return {
        ok: false,
        message: `Conflicting destination: ${(planned.conflicts ?? []).map((item) => item.toUpperCase()).join(", ")}`,
      };
    }
    if (planned.error === "analysis-incomplete") {
      return {
        ok: false,
        message:
          "Macro analysis reached an expansion limit. No registers were changed.",
      };
    }
    if (planned.error === "unsupported-reference") {
      const kinds = Array.from(
        new Set(planned.unsupported?.map(({ kind }) => kind)),
      ).join(", ");
      return {
        ok: false,
        message: `Cannot safely edit ${kinds || "one or more references"}.`,
      };
    }
    if (planned.error || !planned.edits.length) {
      return {
        ok: false,
        message:
          planned.error === "stale-document"
            ? "The document changed. Refresh and try again."
            : "No register changes to apply.",
      };
    }
    if (editor.document.version !== planned.documentVersion) {
      return {
        ok: false,
        message: "The document changed during analysis. Refresh and try again.",
      };
    }
    const applied = await applyProtocolEdits(editor, planned.edits);
    return applied
      ? { ok: true, message: `Applied ${planned.edits.length} replacements.` }
      : { ok: false, message: "Unable to apply register mappings." };
  };

  const remappingView = new RegisterRemappingView(
    loadRemappingModel,
    applyRemappings,
    async (mappings) => {
      clearPreview();
      const request = previewGeneration;
      const snapshot = remappingContext;
      if (!Object.entries(mappings).some(([a, b]) => a !== b)) return [];

      if (!snapshot?.isCurrent())
        return ["The editor scope changed. Refresh to validate."];
      const plan = await client.sendRequest(RegisterRemapRequest, {
        textDocument: { uri: snapshot.uri },
        documentVersion: snapshot.documentVersion,
        range: snapshot.range,
        mappings,
      });
      if (!snapshot.isCurrent() || request !== previewGeneration) return [];
      const normal: DecorationOptions[] = [],
        warning: DecorationOptions[] = [];
      for (const item of remappingHighlights(
        previewUsage,
        mappings,
        plan?.warnings ?? [],
      )) {
        (item.warning ? warning : normal).push({
          range: new Range(
            item.range.start.line,
            item.range.start.character,
            item.range.end.line,
            item.range.end.character,
          ),
          hoverMessage: item.hover,
          renderOptions: {
            after: {
              contentText: ` → ${item.destination}`,
              margin: "0 0.4em",
              color: new ThemeColor(
                item.warning
                  ? "editorWarning.foreground"
                  : "editorInfo.foreground",
              ),
            },
          },
        });
      }
      for (const editor of window.visibleTextEditors)
        if (editor.document.uri.toString() === snapshot.uri) {
          editor.setDecorations(previewMark, normal);
          editor.setDecorations(previewWarning, warning);
        }
      if (plan?.validationIncomplete)
        return [
          ...(plan.warnings ?? []),
          "Checked explicit instructions only; some macro or register-list references could not be checked.",
        ];
      if (!plan || plan.error)
        return ["Unable to validate this mapping in the current scope."];
      return plan.warnings ?? [];
    },
    clearPreview,
    highlightUsage,
  );

  const listRegistersInSelection = async () => {
    const editor = window.activeTextEditor;
    if (!editor || !isM68kEditor(editor)) {
      void window.showWarningMessage("Open an M68k assembly file first.");
      return;
    }
    const scope = await registerCommandScope(editor);
    if (!scope) {
      return;
    }
    const { range } = scope;

    const usage = await client.sendRequest(RegisterUsageRequest, {
      textDocument: { uri: editor.document.uri.toString() },
      range,
    });
    const usageByName = new Map(
      usage?.registers.map((register) => [register.name, register]),
    );

    const usedRegisters = generalPurposeRegisters.filter((register) =>
      usageByName.has(register),
    );
    const unusedRegisters = generalPurposeRegisters.filter(
      (register) => !usageByName.has(register),
    );
    const items: QuickPickItem[] = [
      {
        label: `Used (${usedRegisters.length})`,
        kind: QuickPickItemKind.Separator,
      },
      ...usedRegisters.map((register) =>
        registerItem(register, usageByName.get(register)),
      ),
      {
        label: `Unused (${unusedRegisters.length})`,
        kind: QuickPickItemKind.Separator,
      },
      ...unusedRegisters.map((register) => registerItem(register)),
    ];
    await window.showQuickPick(items, {
      title: "M68k Registers",
      placeHolder: `${usedRegisters.length} used, ${unusedRegisters.length} unused`,
    });
  };

  const swapRegistersInSelection = async () => {
    const editor = window.activeTextEditor;
    if (!editor || !isM68kEditor(editor)) {
      void window.showWarningMessage("Open an M68k assembly file first.");
      return;
    }
    const scope = await registerCommandScope(editor);
    if (!scope) {
      return;
    }
    const { range } = scope;

    const usage = await client.sendRequest(RegisterUsageRequest, {
      textDocument: { uri: editor.document.uri.toString() },
      range,
    });
    const used = usage?.registers ?? [];
    if (!used.length) {
      void window.showWarningMessage(
        "The selection does not use any general-purpose registers.",
      );
      return;
    }

    const first =
      used.length === 1
        ? used[0].name
        : await pickRegister("Select the source register", used);
    if (!first) {
      return;
    }
    const usageByName = new Map(used.map((item) => [item.name, item]));
    const second = await pickDestinationRegister(first, usageByName);
    if (!second) {
      return;
    }
    const pair: [string, string] = [first, second];

    const planned = await client.sendRequest(RegisterSwapRequest, {
      textDocument: { uri: editor.document.uri.toString() },
      documentVersion: usage!.documentVersion,
      range,
      registers: pair,
    });
    if (!planned) {
      void window.showErrorMessage("Register swap analysis is unavailable.");
      return;
    }
    if (planned.error === "stale-document") {
      void window.showWarningMessage(
        "The document changed during analysis. Run the command again.",
      );
      return;
    }
    if (planned.error === "analysis-incomplete") {
      void window.showWarningMessage(
        "Macro analysis reached an expansion limit. No registers were changed.",
      );
      return;
    }
    if (planned.error === "unsupported-reference") {
      const kinds = Array.from(
        new Set(planned.unsupported?.map(({ kind }) => kind)),
      ).join(", ");
      void window.showWarningMessage(
        `This swap includes references that cannot be edited safely yet${kinds ? `: ${kinds}` : "."}`,
      );
      return;
    }
    if (planned.error || !planned.edits.length) {
      void window.showWarningMessage("No safe register swap was found.");
      return;
    }

    const destinationIsUsed = usageByName.has(second);
    const action = destinationIsUsed
      ? `Swap ${first.toUpperCase()} and ${second.toUpperCase()}`
      : `Replace ${first.toUpperCase()} with ${second.toUpperCase()}`;
    const confirmation = await window.showWarningMessage(
      `${action} in ${planned.edits.length} places?`,
      { modal: true },
      "Swap",
    );
    if (confirmation !== "Swap") {
      return;
    }
    if (editor.document.version !== planned.documentVersion) {
      void window.showWarningMessage(
        "The document changed during analysis. Run the command again.",
      );
      return;
    }

    const applied = await applyProtocolEdits(editor, planned.edits);
    if (!applied) {
      void window.showErrorMessage("Unable to apply the register swap.");
    }
  };

  context.subscriptions.push(
    ...decorations.values(),
    window.onDidChangeActiveTextEditor(refresh),
    window.onDidChangeActiveTextEditor(() => void remappingView.refresh()),
    window.onDidChangeVisibleTextEditors(refresh),
    window.onDidChangeTextEditorSelection(() => void remappingView.refresh()),
    workspace.onDidChangeTextDocument(({ document }) => {
      const editor = window.visibleTextEditors.find(
        ({ document: visible }) =>
          visible.uri.toString() === document.uri.toString(),
      );
      if (editor) {
        void applyDecorations(editor);
      }
      if (
        document.uri.toString() ===
        window.activeTextEditor?.document.uri.toString()
      ) {
        void remappingView.refresh();
      }
    }),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("m68k.registerColours.enabled")) {
        enabled = workspace
          .getConfiguration("m68k.registerColours")
          .get<boolean>("enabled", true);
        refresh();
        void remappingView.refresh();
      }
    }),
    commands.registerCommand("m68k.toggleRegisterColours", () => {
      enabled = !enabled;
      refresh();
      void remappingView.refresh();
    }),
    commands.registerCommand(
      "m68k.listRegistersInSelection",
      listRegistersInSelection,
    ),
    commands.registerCommand(
      "m68k.swapRegistersInSelection",
      swapRegistersInSelection,
    ),
  );

  // The server bundle is copied next to the extension at build time, so the
  // packaged extension carries no node_modules of its own.
  const serverModule = context.asAbsolutePath(
    process.env["M68K_SERVER_PATH"] || path.join("out", "server.js"),
  );
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  const config = workspace.getConfiguration("m68k");

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "vasmmot" },
      { scheme: "file", language: "m68k" },
    ],
    synchronize: {},
    initializationOptions: {
      ...config,
    },
  };

  client = new LanguageClient(
    "m68k",
    "Motorola 68000 Assembly",
    serverOptions,
    clientOptions,
  );

  client.onNotification(IndexChangedNotification, () => {
    refresh();
    void remappingView.refresh();
  });

  context.subscriptions.push(
    remappingView,
    window.registerWebviewViewProvider(
      RegisterRemappingView.viewType,
      remappingView,
    ),
  );

  void client.start().then(() => {
    clientReady = true;
    refresh();
    void remappingView.refresh();
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

function registerItem(
  register: string,
  usage?: RegisterUsageResult["registers"][number],
): QuickPickItem {
  if (!usage) {
    return { label: register.toUpperCase() };
  }
  const access =
    usage.read && usage.written
      ? "read/write"
      : usage.read
        ? "read"
        : usage.written
          ? "write"
          : "access unknown";
  return {
    label: register.toUpperCase(),
    description: usage.input ? `${access}, input` : access,
  };
}

async function pickRegister(
  title: string,
  registers: RegisterUsageResult["registers"],
): Promise<string | undefined> {
  const picked = await window.showQuickPick(
    registers.map((usage) => ({
      ...registerItem(usage.name, usage),
      register: usage.name,
    })),
    { title },
  );
  return picked?.register;
}

async function registerCommandScope(
  editor: TextEditor,
  showWarning = true,
): Promise<RegisterCommandScope | undefined> {
  if (!editor.selection.isEmpty) {
    return { range: editor.selection };
  }
  const scope = await client.sendRequest(RoutineRangeRequest, {
    textDocument: { uri: editor.document.uri.toString() },
    position: editor.selection.active,
  });
  if (!scope && showWarning) {
    void window.showWarningMessage(
      "Could not determine a register analysis scope.",
    );
  }
  return scope;
}

async function pickDestinationRegister(
  source: string,
  usageByName: Map<string, RegisterUsageResult["registers"][number]>,
): Promise<string | undefined> {
  const available = generalPurposeRegisters.filter(
    (register) => register !== source,
  );
  const used = available.filter((register) => usageByName.has(register));
  const unused = available.filter((register) => !usageByName.has(register));
  const picked = await window.showQuickPick(
    [
      {
        label: `Used (${used.length})`,
        kind: QuickPickItemKind.Separator,
      },
      ...used.map((register) => ({
        ...registerItem(register, usageByName.get(register)),
        register,
      })),
      {
        label: `Unused (${unused.length})`,
        kind: QuickPickItemKind.Separator,
      },
      ...unused.map((register) => ({
        ...registerItem(register),
        register,
      })),
    ],
    {
      title: `Select the destination for ${source.toUpperCase()}`,
    },
  );
  return picked && "register" in picked ? picked.register : undefined;
}

function isM68kEditor(editor: TextEditor): boolean {
  return ["m68k", "vasmmot"].includes(editor.document.languageId);
}

function applyProtocolEdits(
  editor: TextEditor,
  replacements: TextEdit[],
): Thenable<boolean> {
  return editor.edit((edit) => {
    for (const replacement of replacements) {
      edit.replace(toEditorRange(replacement.range), replacement.newText);
    }
  });
}

/** Wire ranges are plain objects; editor APIs use VS Code Range instances. */
function toEditorRange({ start, end }: ProtocolRange): Range {
  return new Range(start.line, start.character, end.line, end.character);
}
