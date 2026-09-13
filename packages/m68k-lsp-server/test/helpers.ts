import { parseFile } from "m68k-parser";
import { pathToFileURL } from "url";
import type * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import path from "path";

import { createContext } from "../src/context";
import { type Config } from "../src/config";

export class NullLogger implements lsp.Logger {
  info() {
    return null;
  }
  warn() {
    return null;
  }
  error() {
    return null;
  }
  log() {
    return null;
  }
}

export function createTestContext(config: Partial<Config> = {}) {
  const workspaceDir = path.join(__dirname, "fixtures");
  const workspaceUri = pathToFileURL(workspaceDir).toString();
  const logger = new NullLogger();

  const connection = {
    sendDiagnostics: vi.fn(),
    sendNotification: vi.fn(),
  } as unknown as lsp.Connection;

  return createContext(
    [{ uri: workspaceUri, name: "fixtures" }],
    logger,
    connection,
    config,
  );
}

export const range = (
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): lsp.Range => ({
  start: { line: startLine, character: startChar },
  end: { line: endLine, character: endChar },
});

export function applyEdits(src: string, edits: lsp.TextEdit[]) {
  const doc = TextDocument.create("file://", "asm68k", 1, src);
  return TextDocument.applyEdits(doc, edits);
}

/** Build the context a Formatter takes, from source text. */
export function formatContext(src: string) {
  return { parsed: parseFile(src), text: src };
}
