import * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import { getUnitFilesByDistance } from "../files";
import {
  getDefinitions,
  isLocalLabel,
  resolveDefinitionByName,
  type Definition,
} from "../symbols";

export default class CallHierarchyProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onPrepare({
    textDocument,
    position,
  }: lsp.CallHierarchyPrepareParams): Promise<lsp.CallHierarchyItem[] | null> {
    const defs = await getDefinitions(textDocument.uri, position, this.ctx);
    const def = defs.find((d) => !isLocalLabel(d.name));
    return def ? [toCallHierarchyItem(def)] : null;
  }

  async onIncomingCalls({
    item,
  }: lsp.CallHierarchyIncomingCallsParams): Promise<
    lsp.CallHierarchyIncomingCall[] | null
  > {
    const scope = getUnitFilesByDistance(item.uri, this.ctx);
    scope.push(item.uri);

    // Grouped by caller, so a routine calling the target more than once
    // reports one entry with every call site rather than one entry each.
    const grouped = new Map<string, lsp.CallHierarchyIncomingCall>();

    for (const depUri of scope) {
      const doc = this.ctx.store.get(depUri);
      if (!doc) {
        continue;
      }
      for (const call of doc.symbols.calls) {
        if (call.target !== item.name || !call.caller) {
          continue;
        }
        const callerDef = doc.symbols.definitions.get(call.caller);
        if (!callerDef) {
          continue;
        }
        const key = `${depUri}#${call.caller}`;
        let entry = grouped.get(key);
        if (!entry) {
          entry = { from: toCallHierarchyItem(callerDef), fromRanges: [] };
          grouped.set(key, entry);
        }
        entry.fromRanges.push(call.location.range);
      }
    }

    return Array.from(grouped.values());
  }

  async onOutgoingCalls({
    item,
  }: lsp.CallHierarchyOutgoingCallsParams): Promise<
    lsp.CallHierarchyOutgoingCall[] | null
  > {
    const doc = this.ctx.store.get(item.uri);
    if (!doc) {
      return null;
    }

    // Grouped by target, so calling the same routine twice reports one entry.
    const grouped = new Map<string, lsp.CallHierarchyOutgoingCall>();

    for (const call of doc.symbols.calls) {
      if (call.caller !== item.name) {
        continue;
      }
      const targetDef = resolveDefinitionByName(
        item.uri,
        call.target,
        this.ctx,
      );
      if (!targetDef) {
        continue;
      }
      const key = `${targetDef.location.uri}#${targetDef.name}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = { to: toCallHierarchyItem(targetDef), fromRanges: [] };
        grouped.set(key, entry);
      }
      entry.fromRanges.push(call.location.range);
    }

    return Array.from(grouped.values());
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.languages.callHierarchy.onPrepare(this.onPrepare.bind(this));
    connection.languages.callHierarchy.onIncomingCalls(
      this.onIncomingCalls.bind(this),
    );
    connection.languages.callHierarchy.onOutgoingCalls(
      this.onOutgoingCalls.bind(this),
    );
    return {
      callHierarchyProvider: true,
    };
  }
}

function toCallHierarchyItem(def: Definition): lsp.CallHierarchyItem {
  return {
    name: def.name,
    kind: lsp.SymbolKind.Function,
    uri: def.location.uri,
    range: def.location.range,
    selectionRange: def.selectionRange,
  };
}
