import { activate } from "../src/extension";
import { type ExtensionContext, window } from "vscode";
import type {
  RegisterRemappingModel,
  RegisterRemappingResult,
} from "../src/RegisterRemappingView";

let mockLoad: (
  isCurrent?: () => boolean,
) => Promise<RegisterRemappingModel | undefined>;
let mockApply: (
  mappings: Record<string, string>,
) => Promise<RegisterRemappingResult>;
const mockSendRequest = vi.fn();

vi.mock("../src/RegisterRemappingView", () => ({
  RegisterRemappingView: class {
    static viewType = "m68k.registerRemapping";
    constructor(load: typeof mockLoad, apply: typeof mockApply) {
      mockLoad = load;
      mockApply = apply;
    }
    refresh() {}
  },
}));
vi.mock("vscode-languageclient/node", () => ({
  TransportKind: { ipc: 1 },
  LanguageClient: class {
    sendRequest = mockSendRequest;
    onNotification = vi.fn();
    start() {
      return Promise.resolve();
    }
  },
}));
vi.mock(
  "vscode",
  () => ({
    DecorationRangeBehavior: { ClosedClosed: 1 },
    Range: class {},
    commands: { registerCommand: vi.fn() },
    workspace: {
      getConfiguration: () => ({
        get: (_key: string, fallback: unknown) => fallback,
      }),
      onDidChangeTextDocument: vi.fn(),
      onDidChangeConfiguration: vi.fn(),
    },
    window: {
      visibleTextEditors: [],
      createTextEditorDecorationType: vi.fn(),
      onDidChangeActiveTextEditor: vi.fn(),
      onDidChangeVisibleTextEditors: vi.fn(),
      onDidChangeTextEditorSelection: vi.fn(),
      registerWebviewViewProvider: vi.fn(),
    },
  }),
  { virtual: true },
);

it.each([false, true])(
  "checks the document version after remap analysis (changed=%s)",
  async (changed) => {
    const editor = {
      document: {
        uri: { toString: () => "file:///test.s" },
        languageId: "m68k",
        version: 1,
      },
      selection: {
        isEmpty: true,
        active: { line: 0, character: 1 },
        isEqual: () => true,
      },
      edit: vi.fn().mockResolvedValue(true),
    };
    Object.assign(window, { activeTextEditor: editor });
    activate({
      subscriptions: [],
      asAbsolutePath: (path: string) => path,
    } as unknown as ExtensionContext);
    await Promise.resolve();
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 1, character: 0 },
    };
    mockSendRequest.mockReset();
    mockSendRequest
      .mockResolvedValueOnce({ range, label: "Start" })
      .mockResolvedValueOnce({ documentVersion: 1, registers: [] });
    await mockLoad();
    let finish!: (result: unknown) => void;
    mockSendRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const applying = mockApply({ d0: "d1" });
    if (changed) editor.document.version = 2;
    finish({ documentVersion: 1, edits: [{ range, newText: "d1" }] });
    const result = await applying;
    expect(result.ok).toBe(!changed);
    expect(editor.edit).toHaveBeenCalledTimes(changed ? 0 : 1);
    if (changed) expect(result.message).toContain("changed during analysis");
  },
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("does not let an older model overwrite the current remapping scope", async () => {
  const editor = {
    document: {
      uri: { toString: () => "file:///test.s" },
      languageId: "m68k",
      version: 1,
    },
    selection: {
      isEmpty: true,
      active: { line: 0, character: 1 },
      isEqual: () => true,
    },
    edit: vi.fn().mockResolvedValue(true),
  };
  Object.assign(window, { activeTextEditor: editor });
  activate({
    subscriptions: [],
    asAbsolutePath: (path: string) => path,
  } as unknown as ExtensionContext);
  await Promise.resolve();
  mockSendRequest.mockReset();
  const oldScope = {
    start: { line: 0, character: 0 },
    end: { line: 2, character: 0 },
  };
  const newScope = {
    start: { line: 3, character: 0 },
    end: { line: 5, character: 0 },
  };
  const oldUsage = deferred<unknown>();
  const requested = deferred<void>();
  mockSendRequest
    .mockResolvedValueOnce({ range: oldScope, label: "Old" })
    .mockImplementationOnce(() => {
      requested.resolve();
      return oldUsage.promise;
    });
  const oldLoad = mockLoad();
  await requested.promise;
  mockSendRequest
    .mockResolvedValueOnce({ range: newScope, label: "New" })
    .mockResolvedValueOnce({ documentVersion: 1, registers: [] });
  expect((await mockLoad())?.scope).toContain("New");
  oldUsage.resolve({ documentVersion: 1, registers: [] });
  expect(await oldLoad).toBeUndefined();
  mockSendRequest.mockResolvedValueOnce({ documentVersion: 1, edits: [] });
  await mockApply({ d0: "d1" });
  expect(mockSendRequest).toHaveBeenLastCalledWith(
    expect.objectContaining({ method: "m68k/registerRemap" }),
    expect.objectContaining({ range: newScope }),
  );
});

it("discards a model if the document changes while its scope is being fetched", async () => {
  const editor = {
    document: {
      uri: { toString: () => "file:///test.s" },
      languageId: "m68k",
      version: 1,
    },
    selection: {
      isEmpty: true,
      active: { line: 0, character: 1 },
      isEqual: () => true,
    },
    edit: vi.fn(),
  };
  Object.assign(window, { activeTextEditor: editor });
  activate({
    subscriptions: [],
    asAbsolutePath: (path: string) => path,
  } as unknown as ExtensionContext);
  await Promise.resolve();
  mockSendRequest.mockReset();
  const scope = deferred<unknown>();
  mockSendRequest.mockReturnValueOnce(scope.promise);
  const pending = mockLoad();
  editor.document.version = 2;
  scope.resolve({
    range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
  });
  expect(await pending).toBeUndefined();
  expect(mockSendRequest).toHaveBeenCalledTimes(1);
  expect((await mockApply({ d0: "d1" })).ok).toBe(false);
  expect(editor.edit).not.toHaveBeenCalled();
});

it("invalidates Apply as soon as the loaded model is superseded", async () => {
  const editor = {
    document: {
      uri: { toString: () => "file:///test.s" },
      languageId: "m68k",
      version: 1,
    },
    selection: {
      isEmpty: true,
      active: { line: 0, character: 1 },
      isEqual: () => true,
    },
    edit: vi.fn(),
  };
  Object.assign(window, { activeTextEditor: editor });
  activate({
    subscriptions: [],
    asAbsolutePath: (path: string) => path,
  } as unknown as ExtensionContext);
  await Promise.resolve();
  mockSendRequest.mockReset();
  mockSendRequest
    .mockResolvedValueOnce({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 2, character: 0 },
      },
    })
    .mockResolvedValueOnce({ documentVersion: 1, registers: [] });
  let current = true;
  await mockLoad(() => current);
  current = false;
  expect((await mockApply({ d0: "d1" })).ok).toBe(false);
  expect(mockSendRequest).toHaveBeenCalledTimes(2);
  expect(editor.edit).not.toHaveBeenCalled();
});
