import { registerRemapWarnings } from "../registerRemapValidation";
import {
  RegisterRangesRequest,
  RegisterUsageRequest,
  RegisterSwapRequest,
  RegisterRemapRequest,
  RoutineRangeRequest,
} from "@m68k-lsp/protocol";
import type {
  RegisterUsageParams,
  RegisterUsageResult,
  RegisterSwapParams,
  RegisterSwapResult,
  RegisterRemapParams,
  RegisterRemapResult,
  RoutineRangeParams,
  RoutineRangeResult,
} from "@m68k-lsp/protocol";
import * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import {
  analyzeRegisterUsage,
  canonicalGeneralPurposeRegister,
  findRoutineRange,
  registerRanges,
} from "../registerAnalysis";

export default class RegisterProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  register(connection: lsp.Connection) {
    connection.onRequest(RegisterRangesRequest, ({ uri }) =>
      registerRanges(this.ctx, uri),
    );
    connection.onRequest(RegisterUsageRequest, this.onRegisterUsage.bind(this));
    connection.onRequest(RegisterSwapRequest, this.onRegisterSwap.bind(this));
    connection.onRequest(RegisterRemapRequest, this.onRegisterRemap.bind(this));
    connection.onRequest(RoutineRangeRequest, this.onRoutineRange.bind(this));
    return {};
  }

  onRegisterUsage(
    params: RegisterUsageParams,
  ): RegisterUsageResult | undefined {
    return analyzeRegisterUsage(this.ctx, params);
  }

  onRoutineRange(params: RoutineRangeParams): RoutineRangeResult | undefined {
    return findRoutineRange(this.ctx, params);
  }

  onRegisterSwap(params: RegisterSwapParams): RegisterSwapResult | undefined {
    const document = this.ctx.store.get(params.textDocument.uri);
    if (!isProcessed(document)) {
      return;
    }
    if (document.document.version !== params.documentVersion) {
      return {
        documentVersion: document.document.version,
        edits: [],
        error: "stale-document",
      };
    }

    const first = canonicalGeneralPurposeRegister(params.registers[0]);
    const second = canonicalGeneralPurposeRegister(params.registers[1]);
    if (!first || !second || first === second) {
      return {
        documentVersion: document.document.version,
        edits: [],
        error: "invalid-registers",
      };
    }
    const registers: [string, string] = [first, second];

    const usage = this.onRegisterUsage(params);
    if (!usage) {
      return;
    }
    if (usage.incomplete) {
      return {
        documentVersion: document.document.version,
        edits: [],
        error: "analysis-incomplete",
      };
    }
    const byName = new Map(usage.registers.map((item) => [item.name, item]));
    const selected = registers.flatMap(
      (register) => byName.get(register)?.references ?? [],
    );
    const unsupported = selected.filter(({ kind }) => kind !== "explicit");
    if (unsupported.length) {
      return {
        documentVersion: document.document.version,
        edits: [],
        error: "unsupported-reference",
        unsupported,
      };
    }

    const edits = registers.flatMap((register, index) => {
      const replacement = registers[index === 0 ? 1 : 0]!;
      return (byName.get(register)?.references ?? []).map((reference) =>
        lsp.TextEdit.replace(
          reference.range,
          matchRegisterCase(reference.spelling, replacement),
        ),
      );
    });
    return {
      documentVersion: document.document.version,
      edits: uniqueEdits(edits),
    };
  }

  onRegisterRemap(
    params: RegisterRemapParams,
  ): RegisterRemapResult | undefined {
    const document = this.ctx.store.get(params.textDocument.uri);
    if (!isProcessed(document)) {
      return;
    }
    if (document.document.version !== params.documentVersion) {
      return {
        documentVersion: document.document.version,
        edits: [],
        error: "stale-document",
      };
    }

    const mappings = new Map<string, string>();
    for (const [rawSource, rawDestination] of Object.entries(params.mappings)) {
      const source = canonicalGeneralPurposeRegister(rawSource);
      const destination = canonicalGeneralPurposeRegister(rawDestination);
      if (!source || !destination) {
        return {
          documentVersion: document.document.version,
          edits: [],
          error: "invalid-mappings",
        };
      }
      if (source !== destination) {
        mappings.set(source, destination);
      }
    }
    if (!mappings.size) {
      return {
        documentVersion: document.document.version,
        edits: [],
        error: "invalid-mappings",
      };
    }

    const usage = this.onRegisterUsage(params);
    if (!usage) {
      return;
    }
    const byName = new Map(usage.registers.map((item) => [item.name, item]));

    const references = Array.from(mappings.keys()).flatMap(
      (source) => byName.get(source)?.references ?? [],
    );
    const unsupported = references.filter(({ kind }) => kind !== "explicit");

    const edits = Array.from(mappings, ([source, destination]) =>
      (byName.get(source)?.references ?? [])
        .filter((reference) => reference.kind === "explicit")
        .map((reference) =>
          lsp.TextEdit.replace(
            reference.range,
            matchRegisterCase(reference.spelling, destination),
          ),
        ),
    ).flat();
    const plannedEdits = uniqueEdits(edits);
    const warnings = registerRemapWarnings(
      document.document,
      plannedEdits,
      this.ctx.config.processors,
    );
    if (usage.incomplete || unsupported.length) {
      return {
        documentVersion: document.document.version,
        edits: [],
        error: usage.incomplete
          ? "analysis-incomplete"
          : "unsupported-reference",
        ...(unsupported.length ? { unsupported } : {}),
        warnings,
        validationIncomplete: true,
      };
    }
    return {
      documentVersion: document.document.version,
      edits: plannedEdits,
      ...(warnings.length ? { warnings } : {}),
    };
  }
}

function matchRegisterCase(spelling: string, register: string): string {
  return spelling === spelling.toUpperCase()
    ? register.toUpperCase()
    : register.toLowerCase();
}

function uniqueEdits(edits: lsp.TextEdit[]): lsp.TextEdit[] {
  return Array.from(
    new Map(edits.map((edit) => [JSON.stringify(edit), edit])).values(),
  );
}
