import type { RegisterUsage } from "@m68k-lsp/protocol";
import {
  type Disposable,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
} from "vscode";

export type RegisterViewUsage = Omit<RegisterUsage, "references">;

export interface RegisterRemappingModel {
  scope: string;
  registers: RegisterViewUsage[];
  colors?: { [k: string]: string | undefined };
}

export interface RegisterRemappingResult {
  ok: boolean;
  message: string;
}

export class RegisterRemappingView implements WebviewViewProvider, Disposable {
  static readonly viewType = "m68k.registerRemapping";

  private view?: WebviewView;
  private refreshGeneration = 0;
  private pendingRefresh?: Promise<void>;
  private messageSubscription?: Disposable;
  private visibilitySubscription?: Disposable;

  constructor(
    private readonly load: (
      isCurrent: () => boolean,
    ) => Promise<RegisterRemappingModel | undefined>,
    private readonly apply: (
      mappings: Record<string, string>,
    ) => Promise<RegisterRemappingResult>,
  ) {}

  resolveWebviewView(view: WebviewView): void {
    this.messageSubscription?.dispose();
    this.visibilitySubscription?.dispose();
    this.refreshGeneration++;
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = webviewHtml(view.webview);
    this.messageSubscription = view.webview.onDidReceiveMessage(
      async (message: { type?: string; mappings?: Record<string, string> }) => {
        if (message.type === "ready" || message.type === "refresh") {
          await this.refresh();
        } else if (message.type === "apply" && message.mappings) {
          const generation = this.refreshGeneration;
          const result = await this.apply(message.mappings);
          if (this.view !== view || this.refreshGeneration !== generation)
            return;
          await view.webview.postMessage({ type: "result", ...result });
          if (result.ok) {
            await this.refresh();
          }
        }
      },
    );
    this.visibilitySubscription = view.onDidChangeVisibility(() => {
      void this.refresh();
    });
  }

  refresh(): Promise<void> {
    this.refreshGeneration++;
    if (!this.view?.visible) {
      return this.pendingRefresh ?? Promise.resolve();
    }
    // One request at a time; selection changes during it require only one
    // further load, using the latest editor state.
    if (!this.pendingRefresh) {
      this.pendingRefresh = Promise.resolve().then(() => this.refreshLatest());
    }
    return this.pendingRefresh;
  }

  private async refreshLatest(): Promise<void> {
    try {
      while (this.view?.visible) {
        const view = this.view;
        const generation = this.refreshGeneration;
        const isCurrent = () =>
          this.view === view &&
          view.visible &&
          this.refreshGeneration === generation;
        try {
          const model = await this.load(isCurrent);
          if (isCurrent()) {
            await view.webview.postMessage({ type: "model", model });
          }
        } catch (error) {
          if (isCurrent()) {
            console.error("Unable to refresh register analysis", error);
          }
        }
        if (this.refreshGeneration === generation) return;
      }
    } finally {
      this.pendingRefresh = undefined;
    }
  }

  dispose(): void {
    this.refreshGeneration++;
    this.view = undefined;
    this.messageSubscription?.dispose();
    this.visibilitySubscription?.dispose();
  }
}

function webviewHtml(webview: Webview): string {
  const nonce = randomNonce();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 10px 12px 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border));
    }
    #scope {
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .options {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-foreground);
    }
    .options input { margin: 0; }
    .header-row {
      margin-top: 7px;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .remap-label { font-weight: bold; }
    main { padding: 4px 12px 4px; }
    .unsaved main { padding-bottom: 44px; }
    .row {
      display: grid;
      grid-template-columns: 2rem 1fr 6.5rem;
      align-items: center;
      min-height: 34px;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent);
    }
    .register { font-family: var(--vscode-editor-font-family); font-weight: 600; }
    .access { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    select, button {
      height: 24px;
      border: 1px solid var(--vscode-dropdown-border);
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      font: inherit;
    }
    select { width: 100%; padding: 0 4px; }
    select.changed { border-color: var(--vscode-focusBorder); }
    footer {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      padding: 8px 12px 10px;
      background: var(--vscode-sideBar-background);
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border));
      flex-drection: row;
      justify-content: space-between;
      display: none;
    }
    .unsaved footer {
      display: flex;
    }
    #status { color: var(--vscode-descriptionForeground); }
    #status.error { color: var(--vscode-editorWarning-foreground); }
    .actions { display: flex; gap: 6px; flex-direction: row; }
    button { padding: 0 10px; cursor: pointer; }
    button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: transparent; }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { cursor: default; opacity: .55; }
    #empty { padding: 14px 0; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <header>
    <div id="scope">No M68k scope</div>
    <div class="header-row">
      <label class="options"><input id="sort-first-use" type="checkbox"> Sort by first use</label>
      <span class="remap-label">Remap:</span>
    </div>
  </header>
  <main><div id="rows"></div><div id="empty">Open an M68k file to begin.</div></main>
  <footer>
    <div id="status"></div>
    <div class="actions">
      <button id="reset">Reset</button>
      <button class="primary" id="apply">Apply</button>
    </div>
  </footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const allRegisters = ${JSON.stringify([
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
    ])};
    let model;
    let mappings = {};
    let sortByFirstUse = vscode.getState()?.sortByFirstUse || false;
    const rows = document.getElementById('rows');
    const empty = document.getElementById('empty');
    const scope = document.getElementById('scope');
    const status = document.getElementById('status');
    const apply = document.getElementById('apply');
    const reset = document.getElementById('reset');
    const sortToggle = document.getElementById('sort-first-use');
    sortToggle.checked = sortByFirstUse;

    function accessLabel(usage) {
      if (!usage) return 'unused';
      const access = usage.read && usage.written ? 'read/write' : usage.read ? 'read' : usage.written ? 'write' : 'unknown';
      const parts = [access];
      if (usage.input) parts.push('input');
      if (usage.availability === 'available') parts.push('available');
      if (usage.availability === 'unknown') parts.push('availability unknown');
      return parts.join(', ');
    }

    function validate() {
      const changed = Object.entries(mappings).filter(([source, destination]) => source !== destination);
      const destinations = changed.map(([, destination]) => destination);
      const duplicate = destinations.find((value, index) => destinations.indexOf(value) !== index);
      const used = new Set((model?.registers || []).map(({ name }) => name));
      const sources = new Set(changed.map(([source]) => source));
      const occupied = destinations.find((destination) => used.has(destination) && !sources.has(destination));
      const conflict = duplicate || occupied;
      status.textContent = conflict ? conflict.toUpperCase() + ' has conflicting mappings' : '';
      status.className = conflict ? 'error' : '';
      const hasUnsavedChanges = changed.length > 0;
      if (hasUnsavedChanges) {
        document.body.classList.add('unsaved');
      } else {
        document.body.classList.remove('unsaved');
      }
    }

    function renderRows() {
      rows.replaceChildren();
      const usageByName = new Map(model.registers.map((usage) => [usage.name, usage]));
      const usages = [...model.registers];
      if (sortByFirstUse) {
        usages.sort((left, right) => left.firstUse.line - right.firstUse.line || left.firstUse.character - right.firstUse.character);
      } else {
        usages.sort((left, right) => allRegisters.indexOf(left.name) - allRegisters.indexOf(right.name));
      }
      for (const usage of usages) {
        const register = usage.name;
        const row = document.createElement('div');
        row.className = 'row';
        const name = document.createElement('div');
        name.className = 'register';
        name.textContent = register.toUpperCase();
        const color = model.colors?.[usage.name];
        if (color) name.style.color = color;
        const access = document.createElement('div');
        access.className = 'access';
        access.textContent = accessLabel(usage);
        const select = document.createElement('select');
        const selectedDestination = mappings[register] || register;
        select.setAttribute('aria-label', 'Map ' + register.toUpperCase());
        for (const destination of allRegisters) {
          const option = document.createElement('option');
          option.value = destination;
          option.textContent = destination.toUpperCase() + (usageByName.has(destination) ? '' : ' (unused)');
          option.selected = destination === selectedDestination;
          select.append(option);
        }
        select.classList.toggle('changed', selectedDestination !== register);
        select.addEventListener('change', () => {
          mappings[register] = select.value;
          select.classList.toggle('changed', select.value !== register);
          validate();
        });
        if (color) select.style.color = color;
        row.append(name, access, select);
        rows.append(row);
      }
      validate();
    }

    function render(nextModel) {
      model = nextModel;
      mappings = {};
      rows.replaceChildren();
      scope.textContent = 'Scope: ' + (model?.scope || 'none');
      empty.textContent = model ? 'No registers used in this scope.' : 'Open an M68k file to begin.';
      empty.hidden = !!model?.registers.length;
      if (!model) {
        validate();
        return;
      }
      renderRows();
    }

    apply.addEventListener('click', () => vscode.postMessage({ type: 'apply', mappings }));
    reset.addEventListener('click', () => render(model));
    sortToggle.addEventListener('change', () => {
      sortByFirstUse = sortToggle.checked;
      vscode.setState({ sortByFirstUse });
      if (model) renderRows();
    });
    window.addEventListener('message', ({ data }) => {
      if (data.type === 'model') render(data.model);
      if (data.type === 'result') {
        status.textContent = data.message;
        status.className = data.ok ? '' : 'error';
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function randomNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () =>
    alphabet.charAt(Math.floor(Math.random() * alphabet.length)),
  ).join("");
}
