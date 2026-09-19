import { type TextEdit } from "vscode-languageserver-types";
import { walkLine } from "m68k-parser";
import { locationAsRange } from "m68k-parser";
import { isBlockDirective, sectionTypeNames } from "m68k-parser";

/**
 * Directives that control assembly flow rather than emitting data. The parser
 * classifies all of these as directives, but the formatter offers a separate
 * case option for them (`m68k.format.case.control`). The block structure comes
 * from the parser; these are the flow directives that are not blocks.
 */
const FLOW_EXTRAS = new Set(["iif", "rem", "erem", "end"]);
const isControlMnemonic = (directive: string) =>
  isBlockDirective(directive) || FLOW_EXTRAS.has(directive);
import { type FormatContext, type Formatter } from "../DocumentFormatter";

export type CaseOptions = Case | Partial<Record<CaseType, Case>>;
type Case = "upper" | "lower" | "any";
type CaseType =
  "instruction" | "directive" | "control" | "register" | "sectionType" | "hex";

const registerTypes = new Set([
  "data-register",
  "address-register",
  "special-register",
  "fpu-data-register",
  "fpu-control-register",
]);

class CaseFormatter implements Formatter {
  constructor(private options: CaseOptions) {}

  format({ parsed, text }: FormatContext): TextEdit[] {
    const edits: TextEdit[] = [];
    const options = this.options;

    const defaultCase = typeof options === "string" ? options : "any";

    const typeCases: Record<CaseType, Case> = {
      instruction: defaultCase,
      directive: defaultCase,
      control: defaultCase,
      register: defaultCase,
      sectionType: defaultCase,
      hex: defaultCase,
    };

    if (typeof options !== "string") {
      for (const type in typeCases) {
        const caseValue = options[type as CaseType];
        if (caseValue) {
          typeCases[type as CaseType] = caseValue;
        }
      }
    }

    const lines = text.split(/\r\n?|\n/);

    const apply = (
      loc: { start: number; end: number; line?: number },
      typeCase: Case,
      line: number,
    ) => {
      if (typeCase === "any") {
        return;
      }
      const current = lines[line]?.slice(loc.start, loc.end);
      if (current === undefined) {
        return;
      }
      const newText =
        typeCase === "lower" ? current.toLowerCase() : current.toUpperCase();
      if (current !== newText) {
        edits.push({ range: locationAsRange(loc, line), newText });
      }
    };

    for (const [index, parsedLine] of parsed.lines.entries()) {
      const { mnemonic, qualifier } = parsedLine;

      if (mnemonic) {
        let mnemonicCase: Case | undefined;
        if (mnemonic.type === "instruction") {
          mnemonicCase = typeCases.instruction;
        } else if (mnemonic.type === "directive") {
          // m68k-parser makes no distinction between assembly-flow directives
          // and the rest, but the formatter offers a separate option for them.
          mnemonicCase = isControlMnemonic(mnemonic.directive.toLowerCase())
            ? typeCases.control
            : typeCases.directive;
        }

        if (mnemonicCase) {
          apply(mnemonic.loc, mnemonicCase, index);
          // A size qualifier takes the case of the mnemonic it belongs to.
          if (qualifier) {
            apply(qualifier.loc, mnemonicCase, index);
          }
        }
      }

      for (const node of walkLine(parsedLine)) {
        if (registerTypes.has(node.type)) {
          apply(node.loc, typeCases.register, index);
        } else if (node.type === "section-type") {
          apply(node.loc, typeCases.sectionType, index);
        } else if (
          node.type === "numeric-literal" &&
          (node as { format?: string }).format === "hex"
        ) {
          apply(node.loc, typeCases.hex, index);
        } else if (
          node.type === "symbol" &&
          mnemonic?.type === "directive" &&
          mnemonic.directive.toLowerCase() === "section" &&
          parsedLine.operands?.length === 1 &&
          (sectionTypeNames as readonly string[]).includes(
            ((node as { name?: string }).name ?? "").toLowerCase(),
          )
        ) {
          // `section bss` names the type directly. With only one operand the
          // parser cannot tell a type from a section name, so it reports a
          // plain symbol; the two-operand `section name,bss` form does give a
          // section-type node.
          apply(node.loc, typeCases.sectionType, index);
        }
      }
    }

    return edits;
  }
}

export default CaseFormatter;
