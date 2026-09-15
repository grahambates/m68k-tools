import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  config: { defaultCpu: "68000", cacheModel: "worst" } as Record<
    string,
    string
  >,
  source: " machine mc68020\n move.l (a0),d0",
  listener: undefined as
    undefined | ((event: { affectsConfiguration: () => boolean }) => void),
  message: vi.fn(),
  decorations: vi.fn(),
  status: {
    text: "",
    tooltip: "",
    command: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  },
}));
vi.mock("vscode", () => {
  const document = {
    uri: "file:///project/test.s",
    getText: () => state.source,
  };
  const editor = {
    document,
    selection: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 20 },
    },
    setDecorations: state.decorations,
  };
  class Disposable {
    dispose() {}
    static from() {
      return new Disposable();
    }
  }
  return {
    Disposable,
    EventEmitter: class {
      listeners = new Set<(document: unknown) => void>();
      event = (listener: (document: unknown) => void) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
      fire(document: unknown) {
        for (const listener of this.listeners) listener(document);
      }
      dispose() {
        this.listeners.clear();
      }
    },
    ThemeColor: class {
      constructor(public id: string) {}
    },
    Range: class {},
    StatusBarAlignment: { Left: 1 },
    ConfigurationTarget: { WorkspaceFolder: 3, Workspace: 2, Global: 1 },
    window: {
      activeTextEditor: editor,
      visibleTextEditors: [editor],
      createTextEditorDecorationType: () => new Disposable(),
      createStatusBarItem: () => state.status,
      onDidChangeTextEditorSelection: vi.fn(),
      onDidChangeActiveTextEditor: vi.fn(),
      showInformationMessage: state.message,
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: (key: string, fallback?: string) => state.config[key] ?? fallback,
      })),
      onDidChangeTextDocument: vi.fn(),
      onDidCloseTextDocument: vi.fn(),
      onDidChangeConfiguration: (listener: typeof state.listener) => {
        state.listener = listener;
      },
    },
  };
});
import {
  window,
  workspace,
  type TextDocument,
  type ExtensionContext,
} from "vscode";
import countSelection from "../src/countSelection";
import { Annotator } from "../src/Annotator";
import {
  counterOptions,
  toggleCacheModel,
  resetCacheModel,
  registerCacheSession,
} from "../src/settings";
import parse, { calculateTotals, formatTiming } from "68kcounter";

beforeEach(() => {
  resetCacheModel();
  vi.clearAllMocks();
  state.config = { defaultCpu: "68000", cacheModel: "worst" };
  state.source = " machine mc68020\n move.l (a0),d0";
});

test("selection counts respect earlier machine directives and all three bus columns", () => {
  countSelection();
  const totals = calculateTotals(parse(state.source).slice(1));
  expect(totals.min).toHaveLength(4);
  expect(state.message).toHaveBeenCalledWith(
    expect.stringContaining(formatTiming(totals.min)),
  );
  expect(state.message).toHaveBeenCalledWith(
    expect.stringContaining("uncached"),
  );
});

test("project defaults are resource scoped and source directives override them", () => {
  state.config.defaultCpu = "68020";
  const options = counterOptions(window.activeTextEditor!.document);
  expect(workspace.getConfiguration).toHaveBeenCalledWith(
    "68kcounter",
    "file:///project/test.s",
  );
  expect(parse(" move.l (a0),d0", options)[0].timing!.values[0]).toHaveLength(
    4,
  );
  expect(
    parse(" machine mc68000\n move.l (a0),d0", options)[1].timing!.values[0],
  ).toHaveLength(3);
});

test("visible annotations refresh when cache settings change", () => {
  const annotator = new Annotator(window.activeTextEditor!.document);
  const worst =
    state.decorations.mock.calls.at(-1)![1][1].renderOptions.before.contentText;
  state.config.cacheModel = "cache";
  state.listener!({ affectsConfiguration: () => true });
  const cached = state.decorations.mock.calls.at(-1)![1][1];
  expect(cached.renderOptions.before.contentText).not.toBe(worst);
  expect(cached.hoverMessage).toContain("reads/prefetches/writes");
  expect(cached.hoverMessage).toContain("cached");
  expect(state.status.text).toContain("Cached");
  annotator.dispose();
});

test("runtime toggles refresh annotations and selection counts without changing the default", () => {
  const annotator = new Annotator(window.activeTextEditor!.document);
  expect(state.status.command).toBe("68kcounter.toggleCacheModel");
  toggleCacheModel();
  expect(state.status.text).toContain("Cached");
  countSelection();
  expect(state.message).toHaveBeenLastCalledWith(
    expect.stringContaining("cached"),
  );
  expect(state.config.cacheModel).toBe("worst");
  const other = {
    uri: "file:///other.s",
  } as unknown as TextDocument;
  expect(counterOptions(other).cacheModel).toBe("worst");
  toggleCacheModel();
  expect(state.status.text).toContain("Uncached");
  // Explicit overrides survive changes to the configured default.
  state.config.cacheModel = "cache";
  state.listener!({ affectsConfiguration: () => true });
  expect(state.status.text).toContain("Uncached");
  resetCacheModel();
  expect(state.status.text).toContain("Cached");
  annotator.dispose();
});

test("closing a document clears its runtime override", () => {
  registerCacheSession({
    subscriptions: [],
  } as unknown as ExtensionContext);
  toggleCacheModel();
  const document = window.activeTextEditor!.document;
  expect(counterOptions(document).cacheModel).toBe("cache");
  vi.mocked(workspace.onDidCloseTextDocument).mock.calls.at(-1)![0](document);
  expect(counterOptions(document).cacheModel).toBe("worst");
});

test("68030 default and runtime cache switching", () => {
  state.config.defaultCpu = "68030";
  state.source = " moveq #1,d0\n rts";
  const options = counterOptions(window.activeTextEditor!.document);
  expect(options.cpu).toBe("68030");
  expect(parse(state.source, options)[0].timing?.values).toEqual([
    [2, 0, 1, 0],
  ]);
  toggleCacheModel();
  expect(
    parse(state.source, counterOptions(window.activeTextEditor!.document))[0]
      .timing?.values,
  ).toEqual([[2, 0, 0, 0]]);
});

test.each(["68040", "68060"])(
  "%s source directives show cached reference costs despite the uncached default",
  (cpu) => {
    state.source = ` machine mc${cpu}\n move.l (a0),d0`;
    const annotator = new Annotator(window.activeTextEditor!.document);
    const annotation = state.decorations.mock.calls.at(-1)![1][1];
    expect(annotation.hoverMessage).toContain("operand reads/writes");
    expect(annotation.hoverMessage).toContain("not external bus transfers");
    expect(state.status.text).toContain(`${cpu} cached`);
    expect(state.status.command).toBeUndefined();
    countSelection();
    expect(state.message).toHaveBeenLastCalledWith(
      expect.stringContaining("not sequence timings"),
    );
    const before = state.status.text;
    toggleCacheModel();
    expect(state.message).toHaveBeenLastCalledWith(
      expect.stringContaining("no uncached model"),
    );
    expect(state.status.text).toBe(before);
    annotator.dispose();
  },
);

test("unsupported cached instruction forms are visible and excluded from totals", () => {
  state.source = " machine mc68060\n movep.l d0,4(a0)";
  const annotator = new Annotator(window.activeTextEditor!.document);
  const annotation = state.decorations.mock.calls.at(-1)![1][1];
  expect(annotation.renderOptions.before.contentText).toContain("?");
  expect(annotation.hoverMessage).toContain("no cached timing");
  expect(state.status.text).toContain("Incomplete timings");
  annotator.dispose();
});
