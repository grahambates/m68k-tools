import { type InstructionTiming, instructionTimings } from "../timings";
import {
  type CacheModel,
  type Cpu,
  defaultCacheModel,
  defaultCpu,
  Directives,
  type Directive,
  toCpu,
} from "../syntax";
import {
  type DirectiveStatement,
  type InstructionStatement,
  type LabelStatement,
  type MacroStatement,
  StatementNode,
} from "./nodes";
import evaluate, { type Variables } from "./evaluate";
import statementSize from "../sizes";
import { calculateTotals } from "../totals";

export interface Line {
  statement: StatementNode;
  macroLines?: Line[];
  bytes?: number;
  bss?: boolean;
  timing?: InstructionTiming;
  /**
   * Line is annotated with timing/size for reference but excluded from the
   * grand totals. Used for macro definition bodies (no code is emitted at the
   * definition site) and REPT bodies (which are counted once via the `endr`
   * aggregate instead).
   */
  reference?: boolean;
}

export default class Parser {
  /** Variable/constants state */
  private vars: Variables = {};

  /** Macro definitions */
  private macros: Record<string, StatementNode[]> = {};

  /** Running total of parsed statement bytes sizes */
  private totalBytes = 0;

  /** The name of the macro currently being defined */
  private currentMacro: string | null = null;

  /** Start of the current repeating group */
  private reptStart: Line | null = null;

  /** Statements in the current repeating group */
  private reptStatements: StatementNode[] = [];

  /** Are we currently in a BSS section */
  private bss = false;

  /** Incrementing counter used to expand `\@` unique macro labels */
  private uniqueId = 0;

  /** Target CPU set from options; the baseline reset at the start of each pass */
  private readonly defaultCpu: Cpu;

  /** Current target CPU, updated by in-source MACHINE / mc680x0 directives */
  private cpu: Cpu;

  /** Which 68020 cache case to report (worst by default) */
  private readonly cacheModel: CacheModel;

  constructor(options: { cpu?: Cpu; cacheModel?: CacheModel } = {}) {
    this.defaultCpu = options.cpu ?? defaultCpu;
    this.cpu = this.defaultCpu;
    this.cacheModel = options.cacheModel ?? defaultCacheModel;
  }

  // Directive groups:

  private assignments: Directive[] = [
    Directives["="],
    Directives.EQU,
    Directives.FEQU,
    Directives.SET,
  ];

  private sections: Directive[] = [
    Directives.SECTION,
    Directives.BSS,
    Directives.BSS_C,
    Directives.BSS_F,
    Directives.DATA,
    Directives.DATA_C,
    Directives.DATA_F,
    Directives.CODE,
    Directives.CODE_C,
    Directives.CODE_F,
  ];

  /**
   * Parse multiple lines of ASM code
   */
  parse(input: string): Line[] {
    // Split input into lines
    const inputLines = input
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");

    // Parse individual statements:
    const statements = inputLines.map((l) => new StatementNode(l));

    // Now do processing to add size/timing info and expand macros:

    // Reset state
    this.vars = {};
    this.macros = {};
    this.uniqueId = 0;

    // Needs two passes to catch all references.
    let lines: Line[] = [];
    for (let i = 0; i < 2; i++) {
      // Reset the CPU target for each top-level pass (but not for nested
      // macro/rept expansion, which should inherit the current target).
      this.cpu = this.defaultCpu;
      lines = this.processStatements(statements);
    }

    return lines;
  }

  /**
   * Add size and timing info to statements
   */
  private processStatements(statements: StatementNode[]): Line[] {
    this.totalBytes = 0;
    this.currentMacro = null;
    this.bss = false;
    this.reptStart = null;
    this.reptStatements = [];

    return statements.map(this.processStatement.bind(this));
  }

  private processStatement(statement: StatementNode): Line {
    // Currently defining a macro - store statements against this name rather
    // than processing now. The body is still annotated for reference.
    if (this.currentMacro) {
      if (statement.opcode?.op.name === Directives.ENDM) {
        // End macro
        this.currentMacro = null;
        return { statement };
      }
      // Add statement to macro
      this.macros[this.currentMacro].push(statement);
      return this.annotateReference(statement);
    }

    // Inside a repeating section (before the closing endr): annotate the body
    // for reference. The emitted total is counted once on the endr line.
    if (this.reptStart && statement.opcode?.op.name !== Directives.ENDR) {
      this.reptStatements.push(statement);
      return this.annotateReference(statement);
    }

    // A MACHINE / mc680x0 directive selects the target CPU for later lines.
    const cpu = this.detectCpu(statement);
    if (cpu) {
      this.cpu = cpu;
    }

    let line: Line = { statement };

    // End of a repeating section:
    if (this.reptStart) {
      line.macroLines = [];
      // Expand and process repeated statements
      const countOp = this.reptStart.statement.operands[0]?.text;
      const reptCount = evaluate(countOp) || 0;
      const statements = this.reptStatements;

      this.reptStart = null;
      this.reptStatements = [];

      // TODO: support REPTN
      for (let i = 0; i < reptCount; i++) {
        line.macroLines = [
          ...line.macroLines,
          ...this.processStatements(statements),
        ];
      }
    }

    // Process types:
    else if (statement.isLabel()) {
      line = this.processLabel(statement);
    } else if (statement.isMacro()) {
      line = this.processMacro(statement);
    } else if (statement.isDirective()) {
      line = this.processDirective(statement);
    } else if (statement.isInstruction()) {
      line = this.processInstruction(statement);
    }

    // Calculate total of lines added by macro/rept:
    if (line.macroLines) {
      const macroTotals = calculateTotals(line.macroLines);
      line.bytes = macroTotals.bytes;
      if (macroTotals.min[0]) {
        line.timing = macroTotals.isRange
          ? {
              values: [macroTotals.min, macroTotals.max],
              labels: ["Min", "Max"],
            }
          : {
              values: [macroTotals.min],
              labels: [],
            };
      }
    }

    // Calculate byte size of this statement:
    else if (!line.bytes) {
      line.bytes = statementSize(statement, this.vars);
      line.bss = this.bss;
    }
    this.totalBytes += line.bytes;

    return line;
  }

  private processLabel(statement: StatementNode & LabelStatement) {
    // Assign running total of bytes to labels names
    // This allows expressions to get byte count from ranges e.g. `dcb.b END-START`
    this.vars[statement.label.text] = this.totalBytes;
    return { statement, bytes: 0, bss: this.bss };
  }

  private processMacro(statement: StatementNode & MacroStatement) {
    const line: Line = { statement };
    const macroName = statement.opcode.op.text;
    const definition = this.macros[macroName];
    if (definition) {
      const args = statement.operands.map((o) => o.text);
      // Each invocation gets a distinct value for `\@` unique labels
      const unique = String(this.uniqueId++);
      const macroStatements = definition.map(({ text }): StatementNode => {
        // Substitute all `\1`..`\n` argument references (handles repeated and
        // multi-digit references) and `\@` unique markers in a single pass.
        const expanded = text.replace(/\\(@|\d+)/g, (match, key) => {
          if (key === "@") {
            return unique;
          }
          const arg = args[Number(key) - 1];
          return arg !== undefined ? arg : match;
        });
        return new StatementNode(expanded);
      });
      line.macroLines = this.processStatements(macroStatements);
    }
    return line;
  }

  private processDirective(statement: StatementNode & DirectiveStatement) {
    const line: Line = { statement };

    // Variable Assignment:
    if (
      statement.label &&
      this.assignments.includes(statement.opcode.op.name) &&
      statement.operands[0]
    ) {
      const value = evaluate(statement.operands[0].text, this.vars);
      if (value !== undefined) {
        this.vars[statement.label.text] = value;
      }
    }

    // Macro definition:
    else if (statement.opcode.op.name === Directives.MACRO) {
      const macroName = statement.label
        ? statement.label.text
        : statement.operands[0]?.text;
      if (macroName) {
        this.currentMacro = macroName.toUpperCase();
        this.macros[this.currentMacro] = [];
      }
    }

    // Rept start:
    else if (statement.opcode.op.name === Directives.REPT) {
      this.reptStart = line;
    }

    // Section:
    else if (this.sections.includes(statement.opcode.op.name)) {
      // Is this a BSS section?
      this.bss =
        statement.opcode.op.name.includes("BSS") ||
        statement.operands.some((o) => o.text.match(/^bss/i));
    }
    return line;
  }

  private processInstruction(statement: StatementNode & InstructionStatement) {
    const line: Line = {
      statement,
      bss: this.bss,
      timing:
        instructionTimings(statement, this.vars, this.cpu, this.cacheModel) ||
        undefined,
    };
    return line;
  }

  /**
   * Detect a CPU target from a `MACHINE mc680x0` directive or a bare `mc680x0`
   * directive. Returns undefined for anything that isn't a supported target.
   */
  private detectCpu(statement: StatementNode): Cpu | undefined {
    const op = statement.opcode?.op;
    if (!op) {
      return undefined;
    }
    if (op.name === Directives.MACHINE) {
      const operand = statement.operands[0];
      return operand ? toCpu(operand.text) : undefined;
    }
    return toCpu(op.text);
  }

  /**
   * Annotate a statement with timing/size for display but flag it as reference
   * so it is excluded from the grand totals. Used for macro definition and
   * REPT bodies. Does not advance the location counter.
   */
  private annotateReference(statement: StatementNode): Line {
    const line: Line = { statement, reference: true, bss: this.bss };
    if (statement.isInstruction()) {
      line.timing =
        instructionTimings(statement, this.vars, this.cpu, this.cacheModel) ||
        undefined;
    }
    line.bytes = statementSize(statement, this.vars);
    return line;
  }
}
