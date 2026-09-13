import { runInNewContext } from "vm";
import { type WebviewView } from "vscode";
import { RegisterRemappingView } from "../src/RegisterRemappingView";

class Element {
  style: Record<string, string> = {};
  children: Element[] = [];
  className = "";
  textContent = "";
  hidden = false;
  classList = { add() {}, remove() {}, toggle() {} };
  addEventListener() {}
  setAttribute() {}
  replaceChildren() {
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
    runInNewContext(script + "\nrender(testModel);", {
      testModel: model,
      acquireVsCodeApi: () => ({ getState() {}, postMessage() {} }),
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
