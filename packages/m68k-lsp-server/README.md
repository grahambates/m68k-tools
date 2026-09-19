# Motorola 68000 family language server

![example workflow](https://github.com/grahambates/m68k-tools/actions/workflows/build.yml/badge.svg)
[![npm version](https://img.shields.io/npm/v/m68k-lsp-server.svg)](https://www.npmjs.com/package/m68k-lsp-server)

[Language Server Protocol](https://github.com/Microsoft/language-server-protocol) implementation for Motorola 68000
family assembly, using [m68k-parser](https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-parser)

- Suitable for use with LSP supporting editors e.g. [Neovim](https://neovim.io/)
- Includes [VS Code extension](https://marketplace.visualstudio.com/items?itemName=gigabates.m68k-lsp)

## Features

- Auto-completion:
  - Instruction mnemonics
  - Assembler directives
  - Registers
  - Symbols
- Code Linting
  - Parser errors
  - Processor support
- Code Folding
- Document Formatting
- Document Highlights
- Document Links
- Document Symbols
- Register usage and availability analysis, navigation, swapping and remapping;
  macro calls are expanded, including macros defined in included files
- Workspace indexing and assembly-unit-aware symbol lookup
- Find References
- Go to definition
- Call Hierarchy
- Hover
  - Instruction/directive documentation
  - Symbol info
- Inlay Hints
  - Evaluated value of constant assignments (`equ`/`fequ`/`=`/`set`)
- Multiple workspaces
- Rename Symbols
- Signature Help

Requires Node.js 22.15.1 or later. The VS Code extension requires VS Code 1.101 or later.

## Installation

Install the package via npm:

```
npm install --global m68k-lsp-server
```

## Usage

### Neovim

Configure using [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig)

e.g.

```lua
require('lspconfig').m68k.setup{
  on_attach = on_attach,
  init_options = {
    includePaths = { '../include', '/home/myuser/includes' },
    format = {
      case = {
        instruction = 'upper'
      }
    }
  }
}
```

### Emacs

See [emacs-m68k](https://github.com/themkat/emacs-m68k)

### Standalone server

Start the server e.g.:

```
m68k-lsp-server --stdio
```

## Configuration

The LSP client can configured using the following settings, either as initialization options, or as a `.m68krc.json` file in your workspace folder or a directory above it, for project specific overrides.

`.m68krc.json` is also read by the linter and its language server for the options they share: `processors`, `includePaths` and `caseSensitive`. A relative include path is taken from the directory of that file. Other keys are ignored by them.

The assembler is run with the custom `vasm.args` followed by what these options imply: `-I` for each include path, `-m` for each processor and `-nocase` when `caseSensitive` is false, each only if the arguments do not already say so. A `-nocase` or `-I` among the arguments is likewise read back as the option, so the two forms agree. Setting `caseSensitive: true` alongside `-nocase` logs a warning.

A JSON schema for the file is published as `m68krc.schema.json` in this package, and is bundled with the VS Code extension. In other editors, reference it from the file:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/m68k-lsp-server@0/m68krc.schema.json"
}
```

### Processors:

Lists the processor(s) that your code is targeted at. This controls completion suggestions and provides diagnostics.

```json
{
  "processors": ["mc68030", "mc68881"]
}
```

Default: `["mc68000"]`

Supported values:
`mc68000`
,`mc68010`
,`mc68020`
,`mc68030`
,`mc68040`
,`mc68060`
,`mc68881`
,`mc68851`
,`cpu32`

### Include Paths:

Additional paths to use to resolve include directives. This is equivalent to `INCDIR` in source. It should probably
include anything you pass to vasm `-I` arguments. Can be absolute or relative; in a `.m68krc.json`, relative paths are taken from that file's directory.

```json
{
  "includePaths": ["../include", "/home/myuser/includes"]
}
```

Default: `[]`

### Source root:

The directory that relative paths in the source, such as `include "lib/defs.i"`, resolve from. It is
where vasm is run, so it should be where your build runs it, usually the project root. Relative to the
`.m68krc.json` it is in (or the workspace folder, from editor settings). Unset, each file's own directory is
used, which is also where vasm is run. The linter and its language server look here for includes too,
after the file's own directory and before the include paths.

```json
{
  "sourceRoot": "."
}
```

Default: unset

### Case Sensitivity:

Whether `Foo` and `foo` are different symbols (labels, constants and macros). They are, unless vasm is
given `-nocase`, so this is on by default. Leave it unset and a `-nocase` among the vasm `args` is
honoured instead; set it to override that either way. Instruction and directive names are always
matched without regard to case. Changing it re-reads every document.

```json
{
  "caseSensitive": false
}
```

Default: unset (case-sensitive unless `-nocase` is in the vasm arguments)

### vasm diagnostics:

The server can use [vasm](http://www.compilers.de/vasm.html) to provide diagnostic messages. When enabled it will assemble source files on save/open and display any errors or warnings.

The server will use a local `vasmm68k_mot` executable if one exists in your path or is configured in `vasm.binPath`, otherwise it will default to a bundled version complied in Web Assembly.

```json
{
  "vasm": {
    "provideDiagnostics": true,
    "binPath": "vasmm68k_mot",
    "args": [],
    "preferWasm": false,
    "exclude": []
  }
}
```

(defaults)

| Property             | Description                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `provideDiagnostics` | Enable vasm diagnostics                                                                                         |
| `binPath`            | Filename or full path of vasm executable binary                                                                 |
| `args`               | Custom arguments to pass to vasm. Include paths and processor(s) from server config will automatically be added |
| `preferWasm`         | Always use bundled Web Assembly vasm                                                                            |
| `exclude`            | File patterns to ignore and not build directly e.g. `["*.i"]`                                                   |

### Inlay hints:

Shows the evaluated value of constant assignments (`equ`, `fequ`, `=`, `set`) inline, when the expression is more than a bare literal.

```json
{
  "inlayHints": {
    "enabled": true
  }
}
```

### Formatting:

Formatting is provided by the [m68k-formatter workspace package](https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-formatter#readme),
which also includes a standalone CLI. Build it with `pnpm run build:formatter`, then
run `node packages/m68k-formatter/cli.js --write 'src/**/*.s'` or use `--check` for CI.

Both the CLI and language server read the nearest `.m68k-format.json` above the
source file. This file contains the options below directly, without the `format`
wrapper. File settings override editor configuration; formatting-request options
such as tab size and spaces/tabs take precedence.

The language server supports document formatting which can be configured using the following options:

#### Case

Enforce consistency of upper/lower case on elements which are normally case insensitive.

| Option  | Behaviour          |
| ------- | ------------------ |
| `upper` | Upper case         |
| `lower` | Lower case         |
| `any`   | Do not change case |

This can either be configured globally for all elements:

```json
{
  "format": {
    "case": "lower"
  }
}
```

or per element type

```json
{
  "format": {
    "case": {
      "instruction": "lower",
      "directive": "lower",
      "control": "upper",
      "sectionType": "lower",
      "register": "lower",
      "hex": "lower"
    }
  }
}
```

| Element       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `instruction` | Instruction mnemonic/size e.g. `move.w`               |
| `directive`   | Assembler directive mnemonic/qualifier e.g. `include` |
| `control`     | Assembler control keywords e.g. `ifeq`/`endc`         |
| `sectionType` | Section type e.g. `bss`                               |
| `register`    | Register name e.g. `d0`,`sr`                          |
| `hex`         | Hexadecimal number literal                            |

Default: `"lower"`

#### Label colon

Determines whether labels should have a colon suffix.

Can be set for all labels:

```json
{
  "format": {
    "labelColon": "on"
  }
}
```

or individually for global and local labels:

```json
{
  "format": {
    "labelColon": {
      "global": "on",
      "local": "off"
    }
  }
}
```

| Option       | Behaviour                                             |
| ------------ | ----------------------------------------------------- |
| `on`         | Add colon                                             |
| `off`        | Remove colon                                          |
| `notInline`  | No colon for labels on same line as instruction       |
| `onlyInline` | Only add colon for labels on same line as instruction |
| `any`        | Do not change                                         |

Default: `"on"`

#### Operand space

Include space between operands e.g. ` move d0, d1`. VASM needs `-spaces` or `-phxass` option to support this.

| Option | Behaviour     |
| ------ | ------------- |
| `on`   | Add space     |
| `off`  | Remove space  |
| `any`  | Do not change |

Default: `"off"`

```json
{
  "format": {
    "operandSpace": "off"
  }
}
```

#### Quotes

Quote style to use for strings and paths.

```json
{
  "format": {
    "quotes": "single"
  }
}
```

| Option   | Behaviour          |
| -------- | ------------------ |
| `single` | Single quotes: `'` |
| `double` | Double quotes: `"` |
| `any`    | Do not change      |

Default: `"double"`

#### Align

Indents elements to align by type.

```json
{
  "format": {
    "align": {
      "mnemonic": 8,
      "operands": 16,
      "comment": 48,
      "operator": 0,
      "value": 0,
      "indentStyle": "space",
      "tabSize": 8,
      "autoExtend": "line"
    }
  }
}
```

(defaults)

| Property            | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `mnemonic`          | Position of instruction/directive mnemonic and size e.g. `move.w`,`include`.          |
| `operands`          | Position of operands e.g. `d0,d1`.                                                    |
| `comment`           | Position of comment following statement. Comments on their own line are not affected. |
| `operator`          | Position of `=` character in constant assignment                                      |
| `value`             | Position of value in constant assignment                                              |
| `standaloneComment` | Position / behaviour of comment with no other elements on the same line.              |
| `indentStyle`       | Character to use for indent - `tab` or `space`.                                       |
| `tabSize`           | Width of tab character to calculate positions when using `tab` indent style.          |
| `autoExtend`        | Behaviour when a component exceeds the available space between positions. See below.  |

Block contents can be indented independently with `format.align.indentConditional`,
`format.align.indentRept`, and `format.align.indentMacro`. Each is an additional
width in columns, defaulting to `0` (disabled). For example:

```json
{
  "format": {
    "align": {
      "indentConditional": 4,
      "indentRept": 4,
      "indentMacro": 4
    }
  }
}
```

Nested widths add together. Opening, alternative (`else`/`elseif`), and closing
directives align at the enclosing level. Mnemonics, operands, assignments, and
aligned comments shift together; labels remain in column zero. Existing
`indentStyle` and `tabSize` settings control the whitespace used. Comments in
column zero and comments configured with `standaloneComment: "ignore"` stay put.

Options for `standaloneComment`:

| Option        | Behaviour                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `"nearest"`   | Align to nearest element position (default). E.g. if current position is closest to mnemonic it snaps to that column |
| `"ignore"`    | Don't align                                                                                                          |
| `elementName` | Align to named element position e.g. `"label"`, `"mnemonic"`, `"operands"`                                           |
| `number`      | Numeric literal position                                                                                             |

Options for `autoExtend`:

| Option  | Behaviour                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `line`  | Adjust the position for the affected line only                                                                                |
| `block` | Adjust the position, maintaining alignment for all lines within the same block i.e. code separated by two or more line breaks |
| `file`  | Adjust the position, maintaining alignment for all lines in the source file                                                   |

#### Trim whitespace

Remove trailing whitespace from lines?

```json
{
  "format": {
    "trimWhitespace": true
  }
}
```

default: `true`

#### Final new line

Require line break on final line?

```json
{
  "format": {
    "finalNewLine": true
  }
}
```

#### End-of-line character

New line type: `lf`, `cr`, `crlf`

```json
{
  "format": {
    "endOfLine": "lf"
  }
}
```

default: `lf`

## TODO

- Full documentation for 68010+ instructions
- Diagnostics
  - Instruction signatures
- Amiga or other platform specific docs?

## License

This project is made available under the MIT License.

## Development

Open the monorepo root and follow the [workspace development instructions](https://github.com/grahambates/m68k-tools#development). Select **Assembly: Extension + server** in VS Code to debug both processes.

## Release notes and licence

See [CHANGELOG.md](CHANGELOG.md) for released changes. Pending release notes live in the root `.changeset` directory. This package is [MIT licensed](LICENSE.md).
