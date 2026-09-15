import { runInNewContext } from "vm";
import { type WebviewView } from "vscode";
import { RegisterRemappingView } from "../src/RegisterRemappingView";

class Element {
  style: Record<string, string> = {};
  children: Element[] = [];
  className = "";
  private text = "";
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  hidden = false;
  classList = { add() {}, remove() {}, toggle() {} };
  listeners: Record<string, () => void> = {};
  addEventListener(event: string, callback: () => void) {
    this.listeners[event] = callback;
  }
  setAttribute() {}
  replaceChildren() {
    this.text = "";
    this.children = [];
  }
  append(...children: Element[]) {
    this.children.push(...children);
  }
}

it.each([undefined, { d0: "#e06c75" }])(
  "renders register rows with colours %j",
  (colors) => {
    const webview = {
      html: "",
      cspSource: "test",
      onDidReceiveMessage: vi.fn(),
    };
    const view = new RegisterRemappingView(vi.fn(), vi.fn());
    view.resolveWebviewView({
      webview,
      onDidChangeVisibility: vi.fn(),
    } as unknown as WebviewView);
    const elements = new Map<string, Element>();
    const script = webview.html.match(
      /<script nonce="[^"]+">([\s\S]*?)<\/script>/,
    )![1];
    const model = {
      scope: "test",
      registers: [{ name: "d0", read: true, written: false }],
      colors,
    };
    const postMessage = vi.fn();
    runInNewContext(script + "\nrender(testModel);", {
      testModel: model,
      acquireVsCodeApi: () => ({ getState() {}, postMessage }),
      window: { addEventListener() {} },
      document: {
        body: new Element(),
        createElement: () => new Element(),
        getElementById: (id: string) => {
          if (!elements.has(id)) elements.set(id, new Element());
          return elements.get(id);
        },
      },
    });
    const rows = elements.get("rows")!.children;
    expect(rows).toHaveLength(1);
    const name = rows[0].children[0];
    for (const event of ["mouseenter", "focus"]) {
      (event === "mouseenter" ? rows[0] : name).listeners[event]();
      expect(postMessage).toHaveBeenLastCalledWith({
        type: "highlight",
        register: "d0",
      });
    }
    for (const event of ["mouseleave", "blur"]) {
      (event === "mouseleave" ? rows[0] : name).listeners[event]();
      expect(postMessage).toHaveBeenLastCalledWith({ type: "highlight" });
    }
    expect(name.listeners.click).toBeUndefined();
    expect(name.listeners.mouseenter).toBeUndefined();
    expect(name.listeners.mouseleave).toBeUndefined();
    expect(rows[0].children[0].textContent).toBe("D0");
    expect(rows[0].children[0].style.color).toBe(colors?.d0);
    expect(rows[0].children[2].style.color).toBe(colors?.d0);
    expect(elements.get("empty")!.hidden).toBe(true);
  },
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function testView() {
  return {
    visible: true,
    webview: {
      html: "",
      cspSource: "test",
      postMessage: vi.fn().mockResolvedValue(true),
      onDidReceiveMessage: vi.fn(),
    },
    onDidChangeVisibility: vi.fn(),
  };
}

it("coalesces refreshes and only posts the latest model", async () => {
  const first = deferred<{ scope: string; registers: [] }>();
  const second = deferred<{ scope: string; registers: [] }>();
  const started = deferred<void>();
  const load = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockImplementationOnce(() => {
      started.resolve();
      return second.promise;
    });
  const view = testView();
  const provider = new RegisterRemappingView(load, vi.fn());
  provider.resolveWebviewView(view as unknown as WebviewView);
  const pending = provider.refresh();
  await Promise.resolve();
  const refreshes = Array.from({ length: 10 }, () => provider.refresh());
  expect(load).toHaveBeenCalledTimes(1);
  expect(load.mock.calls[0][0]()).toBe(false);
  first.resolve({ scope: "old", registers: [] });
  await started.promise;
  expect(view.webview.postMessage).not.toHaveBeenCalled();
  second.resolve({ scope: "new", registers: [] });
  await Promise.all([pending, ...refreshes]);
  expect(load).toHaveBeenCalledTimes(2);
  expect(view.webview.postMessage).toHaveBeenCalledTimes(1);
  expect(view.webview.postMessage).toHaveBeenCalledWith({
    type: "model",
    model: { scope: "new", registers: [] },
  });
});

it.each(["hidden", "disposed"])(
  "drops in-flight results when the view is %s",
  async (state) => {
    const result = deferred<{ scope: string; registers: [] }>();
    const load = vi.fn().mockReturnValue(result.promise);
    const view = testView();
    const provider = new RegisterRemappingView(load, vi.fn());
    provider.resolveWebviewView(view as unknown as WebviewView);
    const pending = provider.refresh();
    await Promise.resolve();
    if (state === "hidden") {
      view.visible = false;
      void provider.refresh();
    } else {
      provider.dispose();
    }
    result.resolve({ scope: "old", registers: [] });
    await pending;
    expect(view.webview.postMessage).not.toHaveBeenCalled();
  },
);

it("does not lose a refresh arriving as the previous post completes", async () => {
  const posted = deferred<boolean>();
  const started = deferred<void>();
  const view = testView();
  view.webview.postMessage.mockImplementationOnce(() => {
    started.resolve();
    return posted.promise;
  });
  const load = vi
    .fn()
    .mockResolvedValueOnce({ scope: "first", registers: [] })
    .mockResolvedValueOnce({ scope: "second", registers: [] });
  const provider = new RegisterRemappingView(load, vi.fn());
  provider.resolveWebviewView(view as unknown as WebviewView);
  const first = provider.refresh();
  await started.promise;
  let last!: Promise<void>;
  posted.resolve(true);
  queueMicrotask(() => {
    last = provider.refresh();
  });
  await first;
  await last;
  expect(load).toHaveBeenCalledTimes(2);
  expect(view.webview.postMessage).toHaveBeenLastCalledWith({
    type: "model",
    model: { scope: "second", registers: [] },
  });
});

it("displays validation warnings without disabling Apply and ignores stale results", () => {
  const webview = { html: "", cspSource: "test", onDidReceiveMessage: vi.fn() };
  new RegisterRemappingView(vi.fn(), vi.fn()).resolveWebviewView({
    webview,
    onDidChangeVisibility: vi.fn(),
  } as unknown as WebviewView);
  const elements = new Map<string, Element>();
  let receive!: (event: { data: unknown }) => void;
  const script = webview.html.match(
    /<script nonce="[^"]+">([\s\S]*?)<\/script>/,
  )![1];
  const context = {
    acquireVsCodeApi: () => ({ getState() {}, postMessage() {} }),
    window: {
      addEventListener: (_name: string, callback: typeof receive) => {
        receive = callback;
      },
    },
    document: {
      body: new Element(),
      createElement: () => new Element(),
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      },
    },
  };
  runInNewContext(
    script +
      '\nrender({ scope: "test", registers: [{ name: "d0" }] }); mappings = { d0: "a0" }; validate();',
    context,
  );
  receive({
    data: {
      type: "validation",
      requestId: 2,
      warnings: ["Line 1: MOVEQ requires a data register"],
    },
  });
  expect(elements.get("status")?.textContent).toContain("MOVEQ");
  expect(elements.get("status")?.className).toBe("warning");
  expect(
    (elements.get("apply") as Element & { disabled?: boolean }).disabled,
  ).not.toBe(true);
  receive({ data: { type: "validation", requestId: 1, warnings: ["stale"] } });
  expect(elements.get("status")?.textContent).not.toContain("stale");
});

it("clears source previews on refresh and disposal", async () => {
  const clear = vi.fn();
  const provider = new RegisterRemappingView(vi.fn(), vi.fn(), vi.fn(), clear);
  await provider.refresh();
  expect(clear).toHaveBeenCalledTimes(1);
  provider.dispose();
  expect(clear).toHaveBeenCalledTimes(2);
});

it("does not publish validation results from an obsolete mapping", async () => {
  const first = deferred<string[]>();
  const validate = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(["latest"]);
  const view = testView();
  const provider = new RegisterRemappingView(vi.fn(), vi.fn(), validate);
  provider.resolveWebviewView(view as unknown as WebviewView);
  const receive = view.webview.onDidReceiveMessage.mock.calls[0][0];
  const pending = receive({
    type: "validate",
    mappings: { d0: "a0" },
    requestId: 1,
  });
  await receive({ type: "validate", mappings: { d0: "d1" }, requestId: 2 });
  first.resolve(["obsolete"]);
  await pending;
  expect(view.webview.postMessage).toHaveBeenCalledTimes(1);
  expect(view.webview.postMessage).toHaveBeenCalledWith({
    type: "validation",
    requestId: 2,
    warnings: ["latest"],
  });
});

it("routes usage highlights and clears them on refresh and disposal", async () => {
  let receive!: (message: unknown) => Promise<void>;
  const highlight = vi.fn();
  const view = new RegisterRemappingView(
    vi.fn(),
    vi.fn(),
    undefined,
    undefined,
    highlight,
  );
  view.resolveWebviewView({
    visible: true,
    webview: {
      cspSource: "test",
      onDidReceiveMessage: (listener: typeof receive) => {
        receive = listener;
        return { dispose() {} };
      },
      postMessage: vi.fn(),
    },
    onDidChangeVisibility: vi.fn(),
  } as unknown as WebviewView);
  await receive({ type: "highlight", register: "d0" });
  expect(highlight).toHaveBeenLastCalledWith("d0");
  await receive({ type: "highlight" });
  expect(highlight).toHaveBeenLastCalledWith(undefined);
  await receive({ type: "highlight", register: "a1" });
  await view.refresh();
  expect(highlight).toHaveBeenLastCalledWith();
  view.dispose();
  expect(highlight).toHaveBeenLastCalledWith();
});
