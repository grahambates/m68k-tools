import {
  CacheModels,
  defaultCacheModel,
  defaultCpu,
  toCpu,
  type ParseOptions,
  type CacheModel,
} from "68kcounter";
import {
  EventEmitter,
  window,
  workspace,
  type TextDocument,
  type ExtensionContext,
} from "vscode";

const overrides = new WeakMap<TextDocument, CacheModel>();
const changes = new EventEmitter<TextDocument>();
export const onDidChangeCacheModel = changes.event;

export function registerCacheSession(context: ExtensionContext): void {
  context.subscriptions.push(
    changes,
    workspace.onDidCloseTextDocument((document) => {
      overrides.delete(document);
    }),
  );
}

export function counterOptions(document: TextDocument): ParseOptions {
  const config = workspace.getConfiguration("68kcounter", document.uri);
  return {
    cpu: toCpu(config.get<string>("defaultCpu", defaultCpu)) ?? defaultCpu,
    cacheModel:
      overrides.get(document) ??
      (config.get<string>("cacheModel") === CacheModels.Cache
        ? CacheModels.Cache
        : defaultCacheModel),
  };
}

export function toggleCacheModel(): void {
  const document = window.activeTextEditor?.document;
  if (!document) return;
  overrides.set(
    document,
    counterOptions(document).cacheModel === CacheModels.Cache
      ? CacheModels.Worst
      : CacheModels.Cache,
  );
  changes.fire(document);
}

export function resetCacheModel(): void {
  const document = window.activeTextEditor?.document;
  if (!document || !overrides.delete(document)) return;
  changes.fire(document);
}
