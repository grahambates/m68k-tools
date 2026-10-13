import { NotificationType0, RequestType } from "vscode-languageserver-protocol";
import type {
  Position,
  Range,
  TextDocumentIdentifier,
  TextEdit,
} from "vscode-languageserver-protocol";

export type { Range, TextEdit } from "vscode-languageserver-protocol";

export type RegisterAccess = "read" | "write" | "readwrite" | "unknown";
export type RegisterAvailability = "available" | "unavailable" | "unknown";

export interface RegisterUsageReference {
  range: Range;
  spelling: string;
  kind: "explicit" | "register-list" | "macro-expansion";
  access: RegisterAccess;
}

export interface RegisterAvailabilityRange {
  /** From the start of the run's first line to the start of its last. */
  range: Range;
  availability: "available" | "unknown";
  /** Free only until a later write replaces the register. */
  untilOverwritten?: boolean;
}

export interface RegisterUsage {
  name: string;
  references: RegisterUsageReference[];
  firstUse: Position;
  /** Start of the register's last reference in the range. */
  lastUse: Position;
  read: boolean;
  written: boolean;
  input?: boolean;
  /** The header comment above the block's label documents it as an output. */
  output?: boolean;
  availability?: RegisterAvailability;
  /**
   * The register is available only until a later write replaces it, rather
   * than for the rest of the flow from the position.
   */
  availableUntilOverwritten?: boolean;
  /**
   * Runs of lines in the range that leave the register alone while its value
   * is not needed (`available`), or might not be (`unknown`).
   */
  availabilityRanges?: RegisterAvailabilityRange[];
}

export interface RegisterUsageResult {
  /** At least one macro expansion was truncated; edits must not use this result. */
  incomplete?: boolean;
  documentVersion: number;
  registers: RegisterUsage[];
}

export interface RegisterUsageParams {
  textDocument: TextDocumentIdentifier;
  range: Range;
  position?: Position;
}

export interface BlockRangeParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface BlockRangeResult {
  range: Range;
  label: string;
}

export interface RegisterSwapParams extends RegisterUsageParams {
  documentVersion: number;
  registers: [string, string];
}

export interface RegisterRemapParams extends RegisterUsageParams {
  documentVersion: number;
  mappings: Record<string, string>;
}

export type RegisterSwapError =
  | "invalid-registers"
  | "stale-document"
  | "unsupported-reference"
  | "analysis-incomplete";

export type RegisterRemapError =
  | "analysis-incomplete"
  | "invalid-mappings"
  | "mapping-conflict"
  | "stale-document"
  | "unsupported-reference";

export interface RegisterSwapResult {
  documentVersion: number;
  edits: TextEdit[];
  error?: RegisterSwapError;
  unsupported?: RegisterUsageReference[];
}

export interface RegisterRemapResult {
  /** Warnings cover explicit references only when macro analysis is incomplete. */
  validationIncomplete?: boolean;
  /** Advisory only: the edit plan remains applicable. */
  warnings?: string[];
  documentVersion: number;
  edits: TextEdit[];
  error?: RegisterRemapError;
  conflicts?: string[];
  unsupported?: RegisterUsageReference[];
}

export interface RegisterRangesParams {
  uri: string;
}

export type RegisterRangesResult = Record<string, Range[]>;

// These definitions are used by both request senders and handlers. Keep their
// method strings stable: other LSP clients also use these custom requests.
export const RegisterRangesRequest = new RequestType<
  RegisterRangesParams,
  RegisterRangesResult,
  void
>("m68k/registerRanges");
export const RegisterUsageRequest = new RequestType<
  RegisterUsageParams,
  RegisterUsageResult | undefined,
  void
>("m68k/registerUsage");
export const RegisterSwapRequest = new RequestType<
  RegisterSwapParams,
  RegisterSwapResult | undefined,
  void
>("m68k/registerSwap");
export const RegisterRemapRequest = new RequestType<
  RegisterRemapParams,
  RegisterRemapResult | undefined,
  void
>("m68k/registerRemap");
export const BlockRangeRequest = new RequestType<
  BlockRangeParams,
  BlockRangeResult | undefined,
  void
>("m68k/blockRange");
export const IndexChangedNotification = new NotificationType0(
  "m68k/indexChanged",
);
