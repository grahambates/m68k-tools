import { parseLine } from "m68k-parser";
import {
  type AddressingMode,
  aliases,
  type Directive,
  isDirective,
  isMnemonic,
  isQualifier,
  type Mnemonic,
  type Qualifier,
  Qualifiers,
} from "../syntax";
import { nodeAddressingMode } from "./operandMode";

export abstract class Node {
  type: string;
  loc: Location;
  text: string;

  constructor(start: number, text: string, type = "") {
    this.type = type;
    this.text = text;
    this.loc = {
      start,
      end: start + text.length,
    };
  }
}

export interface Location {
  start: number;
  end: number;
}

export class LabelNode extends Node {
  name: string;
  local: boolean;
  macro: boolean;

  constructor(start: number, text: string) {
    super(start, text, "Label");
    this.name = text;
    this.local = text.indexOf(".") === 0;
    this.macro = text.includes("@");
  }
}

export class OpcodeNode extends Node {
  op: MnemonicNode | DirectiveNode | MacroNode;
  qualifier?: QualifierNode;

  constructor(start: number, text: string) {
    super(start, text, "Opcode");

    let [op, qualifier] = text.toUpperCase().split(".");
    if (aliases[op]) op = aliases[op];

    if (isMnemonic(op)) {
      this.op = new MnemonicNode(start, op);
      if (qualifier === Qualifiers.S) {
        qualifier = Qualifiers.B;
      }
    } else if (isDirective(op)) {
      this.op = new DirectiveNode(start, op);
    } else {
      this.op = new MacroNode(start, op);
    }

    if (isQualifier(qualifier)) {
      const sepPos = text.indexOf(".");
      this.qualifier = new QualifierNode(start + sepPos + 1, qualifier);
    }
  }
}

export class MnemonicNode extends Node {
  name: Mnemonic;
  constructor(start: number, name: Mnemonic) {
    super(start, name, "Mnemonic");
    this.name = name;
  }
}

export class DirectiveNode extends Node {
  name: Directive;
  constructor(start: number, name: Directive) {
    super(start, name, "Directive");
    this.name = name;
  }
}

export class MacroNode extends Node {
  name: string;
  constructor(start: number, name: string) {
    super(start, name, "Macro");
    this.name = name;
  }
}

export class QualifierNode extends Node {
  name: Qualifier;
  constructor(start: number, name: Qualifier) {
    super(start, name, "Qualifier");
    this.name = name;
  }
}

export class EffectiveAddressNode extends Node {
  mode: AddressingMode;
  constructor(start: number, text: string, mode: AddressingMode) {
    super(start, text, "EffectiveAddress");
    this.mode = mode;
  }
}

export class StringNode extends Node {
  value: string;
  constructor(start: number, text: string, value: string) {
    super(start, text, "String");
    this.value = value;
  }
}

export class MacroArgNode extends Node {
  index: number;
  constructor(start: number, text: string) {
    super(start, text, "MacroArg");
    this.index = parseInt(text.substring(1), 10);
  }
}

export class MacroInvocationsNode extends Node {
  constructor(start: number, text: string) {
    super(start, text, "MacroInvocations");
  }
}

export class CommentNode extends Node {
  constructor(start: number, text: string) {
    super(start, text, "Comment");
  }
}

export class StatementNode extends Node {
  label?: LabelNode;
  opcode?: OpcodeNode;
  operands: Node[];
  comment?: CommentNode;

  constructor(text: string) {
    super(0, text);
    this.operands = [];

    const { value } = parseLine(text);

    if (value.label) {
      const { start, end } = value.label.loc;
      this.label = new LabelNode(start, text.slice(start, end));
    }

    if (value.mnemonic) {
      // Recombine mnemonic and size into a single token (e.g. `move.w`) so
      // that OpcodeNode can apply our own classification and aliases.
      const start = value.mnemonic.loc.start;
      const end = value.qualifier
        ? value.qualifier.loc.end
        : value.mnemonic.loc.end;
      this.opcode = new OpcodeNode(start, text.slice(start, end));
    }

    for (const operand of value.operands ?? []) {
      const { start, end } = operand.loc;
      const opText = text.slice(start, end);
      if (operand.type === "string-literal") {
        this.operands.push(new StringNode(start, opText, operand.content));
      } else if (operand.type === "macro-parameter") {
        if (operand.param === "@") {
          this.operands.push(new MacroInvocationsNode(start, opText));
        } else {
          this.operands.push(new MacroArgNode(start, opText));
        }
      } else {
        this.operands.push(
          new EffectiveAddressNode(start, opText, nodeAddressingMode(operand)),
        );
      }
    }

    if (value.comment) {
      const { start, end } = value.comment.loc;
      this.comment = new CommentNode(start, text.slice(start, end));
    }
  }

  isLabel(): this is LabelStatement {
    return !this.opcode && this.label !== undefined;
  }

  isInstruction(): this is InstructionStatement {
    return this.opcode !== undefined && this.opcode.op instanceof MnemonicNode;
  }

  isDirective(): this is DirectiveStatement {
    return this.opcode !== undefined && this.opcode.op instanceof DirectiveNode;
  }

  isMacro(): this is MacroStatement {
    return this.opcode !== undefined && this.opcode.op instanceof MacroNode;
  }
}

export interface InstructionStatement {
  opcode: {
    op: MnemonicNode;
    qualifier?: QualifierNode;
  };
  operands: EffectiveAddressNode[];
}

export interface DirectiveStatement {
  opcode: {
    op: DirectiveNode;
    qualifier?: QualifierNode;
  };
  operands: Node[];
}

export interface MacroStatement {
  opcode: {
    op: MacroNode;
  };
  operands: Node[];
}

export interface LabelStatement {
  label: LabelNode;
}
