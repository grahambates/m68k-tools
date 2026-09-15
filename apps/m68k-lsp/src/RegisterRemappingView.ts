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
  private validationGeneration = 0;
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
    private readonly validateMappings: (
      mappings: Record<string, string>,
    ) => Promise<string[]> = () => Promise.resolve([]),
    private readonly clearPreview: () => void = () => {},
    private readonly highlightUsage: (register?: string) => void = () => {},
  ) {}

  resolveWebviewView(view: WebviewView): void {
    this.messageSubscription?.dispose();
    this.visibilitySubscription?.dispose();
    this.refreshGeneration++;
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = webviewHtml(view.webview);
    this.messageSubscription = view.webview.onDidReceiveMessage(
      async (message: {
        type?: string;
        mappings?: Record<string, string>;
        requestId?: number;
        register?: string;
      }) => {
        if (message.type === "highlight") {
          this.highlightUsage(
            typeof message.register === "string" ? message.register : undefined,
          );
        } else if (message.type === "ready" || message.type === "refresh") {
          await this.refresh();
        } else if (message.type === "validate" && message.mappings) {
          const generation = ++this.validationGeneration;
          const refresh = this.refreshGeneration;
          let warnings: string[];
          try {
            warnings = await this.validateMappings(message.mappings);
          } catch {
            warnings = ["Unable to validate this mapping."];
          }
          if (
            this.view !== view ||
            generation !== this.validationGeneration ||
            refresh !== this.refreshGeneration
          )
            return;
          await view.webview.postMessage({
            type: "validation",
            requestId: message.requestId,
            warnings,
          });
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
    this.clearPreview();
    this.highlightUsage();
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
    this.clearPreview();
    this.highlightUsage();
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
      margin-bottom: 8px;
    }
    #scope {
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
      text-overflow: ellipsis;
      white-space: nowrap;
      margin: 8px 0 12px;
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
    .row {
      display: grid;
      grid-template-columns: 2rem 1fr 5rem;
      align-items: center;
      min-height: 34px;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent);
    }
    .row:hover, .row:has(.register:focus-visible) { background: var(--vscode-list-hoverBackground); }
    .register:focus-visible { outline: none; }
    .register { cursor: default; background: transparent; border: none; padding: 2px 4px; text-align: left; color: inherit; font-family: var(--vscode-editor-font-family); font-weight: 600; }
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
      margin-top: 12px;
    }
    #status { color: var(--vscode-descriptionForeground); }
    #status.warning { color: var(--vscode-editorWarning-foreground); }
    #status.error { color: var(--vscode-editorError-foreground); }
    #status ul {
      padding-left: 1.8em;
      margin: 0 0 12px 0;
    }
    .actions { display: none; gap: 6px; flex-direction: row; justify-content: end; }
    .unsaved .actions {
      display: flex;
    }
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

    let validationId = 0;
    let validationWarnings = [];
    let conflictMessage = '';
    function showWarnings() {
      const messages = [...validationWarnings];
      if (conflictMessage) {
        messages.unshift(conflictMessage);
      }
      status.replaceChildren();
      status.className = '';
      if (messages.length > 0) {
        const ul = document.createElement('ul');
        for (const message of messages) {
          const li = document.createElement('li');
          li.textContent = message;
          ul.append(li);
        }
        status.className = 'warning';
        status.append(ul);
      }
    }
    function validate() {
      const changed = Object.entries(mappings).filter(([source, destination]) => source !== destination);
      const destinations = changed.map(([, destination]) => destination);
      const duplicate = destinations.find((value, index) => destinations.indexOf(value) !== index);
      const used = new Set((model?.registers || []).map(({ name }) => name));
      const sources = new Set(changed.map(([source]) => source));
      const occupied = destinations.find((destination) => used.has(destination) && !sources.has(destination));
      const conflict = duplicate || occupied;
      conflictMessage = conflict ? conflict.toUpperCase() + ' has conflicting mappings' : '';
      validationWarnings = [];
      showWarnings();
      const requestId = ++validationId;
      vscode.postMessage({ type: 'validate', mappings, requestId });
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
        const name = document.createElement('button');
        name.className = 'register';
        name.textContent = register.toUpperCase();
        name.title = 'Highlight usages of ' + register.toUpperCase();
        name.setAttribute('aria-label', name.title);
        const showUsage = () => vscode.postMessage({ type: 'highlight', register });
        const hideUsage = () => vscode.postMessage({ type: 'highlight' });
        row.addEventListener('mouseenter', showUsage);
        row.addEventListener('mouseleave', hideUsage);
        name.addEventListener('focus', showUsage);
        name.addEventListener('blur', hideUsage);
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
          option.textContent = destination.toUpperCase() + (usageByName.has(destination) ? '' : ' (free)');
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
    reset.addEventListener('click', () => {
      vscode.postMessage({ type: 'highlight' });
      render(model);
    });
    sortToggle.addEventListener('change', () => {
      sortByFirstUse = sortToggle.checked;
      vscode.setState({ sortByFirstUse });
      if (model) renderRows();
    });
    window.addEventListener('message', ({ data }) => {
      if (data.type === 'model') render(data.model);
      if (data.type === 'validation' && data.requestId === validationId) {
        validationWarnings = data.warnings || [];
        showWarnings();
      }
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
