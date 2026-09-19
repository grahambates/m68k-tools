# M68k Parser

A robust TypeScript parser for Motorola 68000 assembly language that generates an Abstract Syntax Tree (AST). Supports parsing individual lines or entire assembly files with comprehensive error reporting.

## Features

- Parse M68k assembly code into a structured AST
- Support for all standard M68k instructions and directives
- Handles multiple addressing modes (immediate, indirect, indexed, PC-relative, etc.)
- Expression parsing with operators and symbols
- Register lists and FPU support
- Macro parameter support
- Resilient error handling - continues parsing and reports all errors
- Full TypeScript type definitions
- Both ESM and CommonJS support
- Command-line interface for quick parsing

## Installation

```bash
npm install m68k-parser
```

## Usage

### As a Library

**Parse a single line:**

```javascript
import { parseLine } from "m68k-parser";

const result = parseLine("label:    move.w     #1,d0    ; comment");

console.log(result.value);
// {
//   label: { type: 'label', label: 'label', scope: 'global', ... },
//   mnemonic: { type: 'instruction', instruction: 'move', ... },
//   qualifier: { type: 'size', size: 'w', ... },
//   operands: [...],
//   comment: { type: 'comment', content: 'comment', ... }
// }

console.log(result.errors); // Array of parse errors, if any
```

**Parse an entire file:**

```javascript
import { parseFile } from "m68k-parser";

const source = `
  move.w  #$1234,d0
  bra.s   loop
loop:
  add.l   d0,d1
  rts
`;

const result = parseFile(source);

console.log(result.lines); // Array of ParsedLine objects
console.log(result.errors); // Array of all parse errors
```

### Command Line Interface

Parse a file and output the AST as JSON:

```bash
# Parse from a file
m68k-parser input.asm

# Parse from stdin
cat input.asm | m68k-parser
echo "move.w #1,d0" | m68k-parser -
```

## API Reference

### `parseLine(source: string): ParserResult<ParsedLine>`

Parses a single line of M68k assembly code.

**Returns:** `ParserResult<ParsedLine>`

- `value`: The parsed line structure
- `errors`: Array of parse errors encountered

### `parseFile(source: string): ParsedFile`

Parses an entire M68k assembly file.

**Returns:** `ParsedFile`

- `lines`: Array of parsed lines
- `errors`: Array of all parse errors from the file

### Type Exports

All AST node types are exported for TypeScript users:

```typescript
import type {
  ParsedLine,
  ParsedFile,
  InstructionNode,
  DirectiveNode,
  OperandNode,
  ExpressionNode,
  // ... and many more
} from "m68k-parser";
```

## Supported Features

### Instructions

All standard M68k instructions including:

- Data movement: `move`, `movea`, `movem`, `lea`, etc.
- Arithmetic: `add`, `sub`, `mul`, `div`, etc.
- Logic: `and`, `or`, `eor`, `not`, etc.
- Shifts/rotates: `lsl`, `asr`, `rol`, `ror`, etc.
- Branches: `bra`, `beq`, `bne`, `jmp`, `jsr`, etc.
- FPU instructions (68881/68882)

### Directives

Common assembler directives:

- `dc`, `ds`, `dcb` - data definition
- `equ`, `set` - symbol definition
- `section`, `org` - program organization
- `include`, `incbin` - file inclusion
- `macro`, `endm` - macro definition
- And many more

### Addressing Modes

- Immediate: `#100`, `#$FF`
- Data/Address registers: `d0-d7`, `a0-a7`
- Register indirect: `(a0)`, `(a0)+`, `-(a0)`
- Displacement: `10(a0)`, `offset(a0)`
- Indexed: `10(a0,d1.w)`, `(a0,d1.l*4)`
- Absolute: `$1000.w`, `label`
- PC-relative: `label(pc)`, `10(pc,d0)`
- Memory indirect (68020+): preindexed `([bd,An,Xn],od)`, postindexed `([bd,An],Xn,od)`
- Bitfields (68020+): `d0{4:8}`, `$dff180{0:8}`, `12(a0){d0:d1}`
- Register pairs (68020+): `d1:d2` for 64-bit `mulu.l`/`divs.l`/`divsl.l` etc., and `(a0):(a1)` for `cas2`

### Expressions

Full expression support with:

- Binary operators: `+`, `-`, `*`, `/`, `&`, `|`, `^`, `<<`, `>>`, etc.
- Unary operators: `-`, `~`, `!`
- Grouping with parentheses
- Numeric literals: decimal, hex (`$FF`), binary (`%1010`), octal (`@77`)
- Symbol references
- Character literals: `'A'`, `('D'<<24)!('O'<<16)`
- Current address (`*`)

## Example Output

Input:

```asm
start:  move.w  #$1234,d0
```

Output:

```json
{
  "label": {
    "type": "label",
    "scope": "global",
    "label": "start",
    "loc": { "start": 0, "end": 5 }
  },
  "mnemonic": {
    "type": "instruction",
    "instruction": "move",
    "loc": { "start": 8, "end": 12 }
  },
  "qualifier": {
    "type": "size",
    "size": "w",
    "loc": { "start": 13, "end": 14 }
  },
  "operands": [
    {
      "type": "immediate",
      "value": {
        "type": "numeric-literal",
        "format": "hex",
        "raw": "$1234",
        "value": 4660
      }
    },
    {
      "type": "data-register",
      "register": "d0"
    }
  ]
}
```

## Error Handling

The parser is resilient and will attempt to parse as much as possible, collecting errors along the way:

```javascript
const result = parseFile("invalid syntax here\nmove.w d0,d1");

result.errors.forEach((error) => {
  console.log(`Line ${error.loc.line}: ${error.message}`);
});
// Still provides parsed output for valid lines
```

## License

MIT - See LICENSE file for details

## Author

Graham Bates

## Repository

https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-parser

## Development

Requires Node.js 22.15.1 or later at runtime. Use the root-pinned Node version for development. From the monorepo root, run `pnpm install --frozen-lockfile`, `pnpm --filter m68k-parser build` and `pnpm --filter m68k-parser test`.

## Constant expressions

`parseExpression` accepts a standalone expression without an immediate `#` prefix.
`evaluateConstant` evaluates its AST with an optional symbol resolver:

```ts
import { parseExpression, evaluateConstant } from "m68k-parser";

const parsed = parseExpression("count+2<<3");
if (parsed.errors.length === 0) {
  const result = evaluateConstant(parsed.value, (name) =>
    name === "count" ? 1 : undefined,
  );
  // { known: true, value: 17 }
}
```

Precedence follows [vasm's expression rules](https://github.com/StarWolf3000/vasm-mirror/blob/master/doc/vasm_main.texi): shifts and bitwise operators bind more tightly than arithmetic. Comparisons and logical binary operators return -1 for true and 0 for false, matching Motorola syntax; unary `!` returns 1 or 0. Division truncates towards zero; `%` and the Motorola-syntax `//` alias calculate remainders. Unknown symbols, address-dependent expressions and unsupported nodes return `{ known: false, reason }`. Check parse errors before evaluating a recovered AST.

Evaluation uses JavaScript numbers and 32-bit bitwise operations; it does not emulate every target-width overflow or assembler compatibility option. Symbol lookup, forward references and cycle detection remain the caller's responsibility.

## Macros

Macro expansion works by text substitution, the way an assembler does it: a
call's arguments are substituted into each line of the macro body, and the result
is parsed as an ordinary line. `d\1`, `\1(a0)` and a parameter that stands for a
size all come out right because the assembler sees nothing but text either.

```ts
import {
  parseFile,
  parseLine,
  collectMacroDefinitions,
  expandMacro,
  macroInvocation,
} from "m68k-parser";

const source = "Clear macro\n\tmoveq #0,d\\1\n\tendm\n";
const definitions = collectMacroDefinitions(
  parseFile(source),
  source.split("\n"),
);

const call = "\tClear 3";
const { lines, incomplete } = expandMacro(
  definitions[0],
  macroInvocation(parseLine(call).value, call),
  { resolve: (name) => definitions.find((d) => d.name === name) },
);
// lines[0].text === "\tmoveq #0,d3"; lines[0].line is its parsed form
```

- `collectMacroDefinitions(file, sourceLines)` lists every complete definition in
  source order, named either by label (`Name: macro`) or by operand
  (`macro Name`). A name defined twice is listed twice, so a caller that needs an
  unambiguous answer can tell.
- `macroInvocation(line, lineText)` takes a call's arguments as source text by
  position, so a bracketed or quoted argument stays whole.
- `expandMacro(definition, invocation, { resolve })` expands one call, following
  calls to other macros through `resolve`, which is how a caller decides where
  definitions come from: one file, a file and its includes, or a whole project.
  `incomplete` is set if a macro called itself or the output hit a limit
  (`maxDepth`, `maxLines`). `unique` supplies the value for `\@`.
- `substituteMacroParameters(text, invocation)` substitutes into one line.

It handles `\0`-`\9`, `\a`-`\z`, `\?n`, `\#`, `\.`, `\+`, `\-`, `\@`, `NARG`
and `CARG`. A numbered argument the call did not supply is empty; a lettered one is
left as written, since outside Devpac mode `\n` in a string is not a parameter.
Each substituted stretch of text can carry an `origin` you supplied for the
argument, and it is traced through nested calls, so a tool can point back at where
an argument was written.

## Other helpers

Small pieces that several tools need, kept here so they agree:

- **Blocks** — `parseBlocks(file)` pairs each `macro`, `rept` and `if` with its
  terminator and nests them; `blockRole`, `blockAt` and `enclosingBlocks` ask
  about a single line. `isBlockDirective(name)` and `isSectionDirective(name)`
  classify a directive, and `sectionTypeNames` lists what a section can be given
  as its type.
- **Symbol case** — `symbolKey(name, caseSensitive = true)` is what a symbol name is
  compared by: the name itself, or lower-cased where the assembler was told to fold
  case (`vasm -nocase`). Compare labels, constants and macros through it. It is
  the default that case matters, as it is for an assembler.
- **Local labels** — `isLocalLabelName(name)` (`.loop`, `loop$`),
  `bareLocalName`, and `analyzeLocalLabelScopes(file)`, which ties each local label
  to the global label whose routine it is in. A label that only defines a symbol
  (`equ` and the other assignments) does not start a routine, and neither does one
  inside a macro body or conditional block.
- **Operands and mnemonics** — `addressingMode(operand)` names the addressing mode
  an operand is written in. `canonicalConditionMnemonic(name)` reads `HS`, `LO` and
  `DBRA` as `CC`, `CS` and `DBF`, and `addressRegisterForm(name)` gives `MOVEA`,
  `ADDA`, `SUBA` or `CMPA` for the generic spelling of an instruction on an address
  register.
- **Data sizes** — `directiveSize(line, { evaluate })` is the number of bytes a
  `dc`, `dcb` or `ds` (and `db`, `dw`, `dl`, `blk`) emits, or `undefined` when it is
  not known. Without a size they take a word, and every character of a string
  counts as written, so `"a\n"` is three bytes, unless `escapeSequences` says the
  assembler reads them (`vasm -esc`). `decodeStringEscapes(content)` gives the
  elements such a string stands for and any sequence vasm calls illegal.
- **Walking and ranges** — `walkLine`, `walkFile`, `childNodes`, `lineNodes` and
  `descendants` traverse a tree structurally, so a node type added later is walked
  without a change. `locationAsRange`, `containsPosition` and `containsRange` work
  on zero-based positions in the shape the language server protocol uses, without
  depending on it.
