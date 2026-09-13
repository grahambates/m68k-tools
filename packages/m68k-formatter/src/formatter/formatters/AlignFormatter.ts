import { parseBlocks, type Block } from "m68k-parser";
import { type TextEdit } from "vscode-languageserver-types";

import { TextDocument } from "vscode-languageserver-textdocument";

import { type ParsedLine, parseLine } from "../../parse";
import { type FormatContext, type Formatter } from "../DocumentFormatter";

export type AlignOptions = {
  indentConditional?: number;
  indentRept?: number;
  indentMacro?: number;
  mnemonic?: number;
  operands?: number;
  comment?: number;
  operator?: number;
  value?: number;
  standaloneComment?:
    | "ignore"
    | "nearest"
    | "label"
    | "mnemonic"
    | "operands"
    | "comment"
    | "operator"
    | "value"
    | number;
  indentStyle?: "space" | "tab";
  tabSize?: number;
  autoExtend?: "line" | "file" | "block";
};

type ElementRange = { start: number; end: number };

interface ElementInfo {
  range: ElementRange;
  edited?: ElementRange;
}

interface LineInfo {
  text: string;
  label?: ElementInfo;
  block: number;
  mnemonic?: ElementInfo;
  operands?: ElementInfo;
  operator?: ElementInfo;
  value?: ElementInfo;
  comment?: ElementInfo;
}

// TODO:
// label position?
// disable autoExtend per component?

class AlignFormatter implements Formatter {
  private shiftWidth: number;
  private char: string;
  private block = 0;

  constructor(private options: AlignOptions) {
    const useTab = options.indentStyle === "tab";
    const tabSize = options.tabSize ?? 8;
    this.shiftWidth = useTab ? tabSize : 1;
    this.char = useTab ? "\t" : " ";
  }

  format(
    { text, parsed }: FormatContext,
    prevEdits: TextEdit[] = [],
  ): TextEdit[] {
    const edits: TextEdit[] = [];
    this.block = 0;

    const { autoExtend } = this.options;
    let mnemonicPosition = this.options.mnemonic ?? 0;
    let operandsPosition = this.options.operands ?? 0;
    let commentPosition = this.options.comment ?? 0;
    let operatorPosition = this.options.operator ?? 0;
    let valuePosition = this.options.value ?? 0;
    const standaloneComment = this.options.standaloneComment ?? "nearest";

    const lineText = text.split(/\r\n?|\n/);
    const lines = lineText.map((text, i) =>
      this.processLine(text, i, prevEdits),
    );

    const indents = new Array<number>(lines.length).fill(0);
    const visit = (blocks: Block[]) => {
      for (const block of blocks) {
        const width =
          (block.kind === "conditional"
            ? this.options.indentConditional
            : block.kind === "repeat"
              ? this.options.indentRept
              : this.options.indentMacro) ?? 0;
        const alternatives = new Set(block.alternatives);
        for (let i = block.start + 1; i < (block.end ?? lines.length); i++) {
          if (!alternatives.has(i)) indents[i] += width;
        }
        visit(block.children);
      }
    };
    visit(parseBlocks(parsed).blocks);

    // For files we only need to calculate adjustments once
    let autoExtended = false;

    // Ignore lines inside REM or after END mnemonic
    let inComment = false;

    for (let line = 0; line < lines.length; line++) {
      const {
        label,
        mnemonic,
        operands,
        operator,
        value,
        comment,
        text,
        block,
      } = lines[line];

      // Check for mnemonics which take us in or out of comment mode:

      const mnemonicText =
        mnemonic &&
        lineText[line]
          .substring(mnemonic.range.start, mnemonic.range.end)
          .toLowerCase();

      if (inComment) {
        if (mnemonicText === "erem") {
          inComment = false;
        } else {
          continue;
        }
      } else if (mnemonicText === "rem" || mnemonicText === "end") {
        inComment = true;
      }

      const labelPosition = 0;

      if (autoExtend === "block" || (autoExtend === "file" && !autoExtended)) {
        let compareLines = lines;
        if (autoExtend === "file") {
          // Flag to avoid reporocessing on each iteration for file mode
          autoExtended = true;
        } else {
          // In block mode limit lines for comparison to those in the same block
          compareLines = lines.filter((l) => l.block === block);
        }

        const max = (values: number[]) =>
          Math.ceil((Math.max(...values) + 1) / this.shiftWidth);

        const maxLabelToMnemonic = max(
          compareLines
            .filter((l) => l.label && l.mnemonic)
            .map((l) => elementLength(l.label)),
        );
        const maxMnemonicToOperands = max(
          compareLines
            .filter((l) => l.mnemonic && l.operands)
            .map((l) => elementLength(l.mnemonic)),
        );
        const maxLabelToOperator = max(
          compareLines
            .filter((l) => l.label && l.operator)
            .map((l) => elementLength(l.label)),
        );
        // Currently always 1
        const maxOperatorToValue = max(
          compareLines
            .filter((l) => l.operator && l.value)
            .map((l) => elementLength(l.operator)),
        );
        const maxOperandsToComment = max(
          compareLines
            .filter((l) => l.operands && l.comment)
            .map((l) => elementLength(l.operands)),
        );
        const maxMnemonicToComment = max(
          compareLines
            .filter((l) => l.mnemonic && !l.operands && l.comment)
            .map((l) => elementLength(l.mnemonic)),
        );
        const maxLabelToComment = max(
          compareLines
            .filter((l) => l.label && !l.mnemonic && l.comment)
            .map((l) => elementLength(l.label)),
        );
        const maxValueToComment = max(
          compareLines
            .filter((l) => l.value && l.comment)
            .map((l) => elementLength(l.value)),
        );

        mnemonicPosition = Math.max(
          labelPosition + maxLabelToMnemonic,
          this.options.mnemonic ?? 0,
        );
        operandsPosition = Math.max(
          mnemonicPosition + maxMnemonicToOperands,
          this.options.operands ?? 0,
        );
        // TODO: should operator and mnemonic be merged if no specific config?
        operatorPosition = Math.max(
          labelPosition + maxLabelToOperator,
          this.options.operator ?? 0,
        );
        valuePosition = Math.max(
          operatorPosition + maxOperatorToValue,
          this.options.value ?? 0,
        );
        commentPosition = Math.max(
          operandsPosition + maxOperandsToComment,
          mnemonicPosition + maxMnemonicToComment,
          labelPosition + maxLabelToComment,
          valuePosition + maxValueToComment,
          this.options.comment ?? 0,
        );
      }

      const indent = indents[line];
      const editor = new LineEditor(text, line, this.shiftWidth, this.char);

      if (label) {
        editor.addIndent(labelPosition, label, 0);
      }
      if (mnemonic) {
        editor.addIndent(mnemonicPosition + indent, mnemonic);
      }
      if (operands) {
        editor.addIndent(operandsPosition + indent, operands);
      }
      if (operator) {
        editor.addIndent(operatorPosition + indent, operator);
      }
      if (value) {
        editor.addIndent(valuePosition + indent, value);
      }
      if (comment) {
        if (!label && !mnemonic && !operands && !operator && !value) {
          if (standaloneComment) {
            if (typeof standaloneComment === "number") {
              // Literal position
              editor.addIndent(standaloneComment + indent, comment, 0);
            } else if (standaloneComment === "nearest") {
              // Find nearest position:
              const possiblePositions = [
                labelPosition,
                mnemonicPosition + indent,
                operandsPosition + indent,
                commentPosition + indent,
                operatorPosition + indent,
                valuePosition + indent,
              ];
              let currentPos = comment.range.start;
              // Adjust position for tab width - can't just just character offset:
              if (this.shiftWidth > 1) {
                const ws = lineText[line].substring(0, comment.range.start);
                for (let i = 0; i < ws.length; i++) {
                  if (ws[i] === "\t") {
                    currentPos += this.shiftWidth - 1;
                  }
                }
              }
              // Calculate absolute delta from each position
              const positionDeltas = possiblePositions.map((o) =>
                Math.abs(o - currentPos),
              );
              // Use index of smallest delta
              const minDelta = Math.min(...positionDeltas);
              const minDeltaIndex = positionDeltas.indexOf(minDelta);
              editor.addIndent(possiblePositions[minDeltaIndex], comment, 0);
            } else if (typeof standaloneComment === "string") {
              // Named position
              const indent =
                this.options[standaloneComment as keyof AlignOptions];
              if (typeof indent === "number") {
                editor.addIndent(indent + indents[line], comment, 0);
              } else {
                editor.addIndent(0, comment, 0);
              }
            }
          }
        } else {
          editor.addIndent(commentPosition + indent, comment);
        }
      }

      edits.push(...editor.edits);
    }

    return edits;
  }

  processLine(text: string, line: number, prevEdits: TextEdit[]): LineInfo {
    if (text.match(/^\s*$/)) {
      this.block++;
      return { text, block: this.block };
    }

    const lineInfo: LineInfo = { text, block: this.block };
    const parsed = parseLine(text);

    // Need to look at edits to this line in case the length of any elements has changed:
    const lineEdits = prevEdits
      // Find edits that apply exclusively to this line
      .filter(
        ({ range: { start, end } }) => start.line === line && end.line === line,
      )
      // Convert them to apply to line 0
      .map((e) => ({
        ...e,
        range: {
          start: { ...e.range.start, line: 0 },
          end: { ...e.range.end, line: 0 },
        },
      }));

    let lineTextFinal = text;
    let parsedFinal = parsed;
    // If there are edits, store and parse the updated version of the line so we can adjust lengths/offsets.
    if (lineEdits.length) {
      // Create a single line document and apply changes
      const editDoc = TextDocument.create("file:///", "m68k", 1, text);
      lineTextFinal = TextDocument.applyEdits(editDoc, lineEdits);
      parsedFinal = parseLine(lineTextFinal);
    }

    const labelRange = getLabelRange(parsed, text);
    if (labelRange) {
      const edited = getLabelRange(parsedFinal, lineTextFinal);
      lineInfo.label = { range: labelRange, edited };
    }

    // Is that statement a constant definition?
    // TODO: should this include EQU, EQUR, FEQ etc?
    const isOp = parsed.mnemonic?.value === "=";

    const mnemonicRange = getMnemonicRange(parsed);
    if (mnemonicRange) {
      const edited = getMnemonicRange(parsedFinal);
      if (isOp) {
        lineInfo.operator = { range: mnemonicRange, edited };
      } else {
        lineInfo.mnemonic = { range: mnemonicRange, edited };
      }
    }

    const operandsRange = getOperandsRange(parsed);
    if (operandsRange) {
      const edited = getOperandsRange(parsedFinal);
      if (isOp) {
        lineInfo.value = { range: operandsRange, edited };
      } else {
        lineInfo.operands = { range: operandsRange, edited };
      }
    }

    if (parsed.comment && parsed.comment.start > 0) {
      lineInfo.comment = { range: parsed.comment };
    }

    return lineInfo;
  }
}

class LineEditor {
  readonly edits: TextEdit[] = [];

  // Tracks position and character offset as we apply indents
  private previousEnd = 0;
  private currentOffset = 0;

  constructor(
    private text: string,
    private line: number,
    private shiftWidth: number,
    private char: string,
  ) {}

  /**
   * Creates edits to adjust indent and align element at desired position
   *
   * @param desiredOffset Desired column/tab position for element
   * @param elementInfo Ranges of element before and after previous edits
   * @param minSpace Minimum space from previous element
   */
  addIndent(
    desiredOffset: number,
    { range, edited = { start: 0, end: 0 } }: ElementInfo,
    minSpace = 1,
  ) {
    let offsetDelta = desiredOffset - this.currentOffset;
    let newText: string;

    // There's a chance the delta might be negative if the previous element is too long to position where we want.
    // In this case insert the minimum amount of whitespace.
    if (offsetDelta > 0) {
      const offsetFloor =
        Math.floor(this.currentOffset / this.shiftWidth) * this.shiftWidth;
      const deltaFromFloor = desiredOffset - offsetFloor;
      const shiftCount = Math.floor(deltaFromFloor / this.shiftWidth);
      const remainder = desiredOffset % this.shiftWidth;
      newText = this.char.repeat(shiftCount) + " ".repeat(remainder);
    } else {
      // Always use spaces for min whitespace
      offsetDelta = minSpace;
      newText = " ".repeat(minSpace);
    }

    const editRequired =
      newText !== this.text.substring(this.previousEnd, range.start);

    if (editRequired) {
      this.edits.push({
        range: {
          start: { character: this.previousEnd, line: this.line },
          end: { character: range.start, line: this.line },
        },
        newText,
      });
    }

    // Update end position
    this.previousEnd = range.end;

    // Update offset:
    // Use the length of the element with previous edits applied.
    // This handles cases where other formatters have changed its length e.g. adding/removing label colon, which
    // would otherwise shift the alignment of subsequent elements.
    const elementLength = edited.end - edited.start;
    this.currentOffset += offsetDelta + elementLength;
  }
}

function elementLength(info?: ElementInfo) {
  if (info?.edited) {
    return info.edited.end - info.edited.start;
  }
  return 0;
}

function getLabelRange(
  { label }: ParsedLine,
  lineText: string,
): ElementRange | undefined {
  if (label) {
    let end = label.end;
    while (lineText.charAt(end) === ":") {
      end++;
    }
    return { start: label.start, end };
  }
}

function getMnemonicRange({
  mnemonic,
  size,
}: ParsedLine): ElementRange | undefined {
  if (mnemonic) {
    return {
      start: mnemonic.start,
      end: size?.end ?? mnemonic.end,
    };
  }
}

function getOperandsRange({ operands }: ParsedLine): ElementRange | undefined {
  if (operands) {
    return {
      start: operands[0].start,
      end: operands[operands.length - 1].end,
    };
  }
}

export default AlignFormatter;
