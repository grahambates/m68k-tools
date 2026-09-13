import {
  type ClientCapabilities,
  type Connection,
  type ServerCapabilities,
} from "vscode-languageserver";
import { type Context } from "../context";

import CompletionProvider from "./CompletionProvider";
import ConfiguratonProvider from "./ConfigurationProvider";
import DefinitionProvider from "./DefinitionProvider";
import DocumentFormattingProvider from "./DocumentFormatttingProvider";
import DocumentHighlightProvider from "./DocumentHighlightProvider";
import DocumentLinkProvider from "./DocumentLinkProvider";
import DocumentSymbolProvider from "./DocumentSymbolProvider";
import FileOperationsProvider from "./FileOperationsProvider";
import FoldingRangeProvider from "./FoldingRangeProvider";
import HoverProvider from "./HoverProvider";
import ReferencesProvider from "./ReferencesProvider";
import RegisterProvider from "./RegisterProvider";
import RenameProvider from "./RenameProvider";
import SignatureHelpProvider from "./SignatureHelpProvider";
import TextDocumentSyncProvider from "./TextDocumentSyncProvider";
import WorkspaceSymbolProvider from "./WorkspaceSymbolProvider";

export interface Provider {
  register(
    connection: Connection,
    clientCapabilities: ClientCapabilities,
  ): ServerCapabilities;
}
const providers = [
  CompletionProvider,
  ConfiguratonProvider,
  DefinitionProvider,
  DocumentFormattingProvider,
  DocumentHighlightProvider,
  DocumentLinkProvider,
  DocumentSymbolProvider,
  FileOperationsProvider,
  FoldingRangeProvider,
  HoverProvider,
  ReferencesProvider,
  RegisterProvider,
  RenameProvider,
  SignatureHelpProvider,
  TextDocumentSyncProvider,
  WorkspaceSymbolProvider,
];

export default function registerProviders(
  connection: Connection,
  ctx: Context,
  clientCapabilities: ClientCapabilities,
): ServerCapabilities {
  return providers.reduce((acc, P) => {
    const p = new P(ctx);
    const c = p.register(connection, clientCapabilities);
    return Object.assign(acc, c);
  }, {});
}
