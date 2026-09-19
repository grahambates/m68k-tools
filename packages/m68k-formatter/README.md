# m68k-formatter

Motorola 68000 assembly formatter, usable as a library or the `m68k-format` CLI.
Requires Node.js 22.15.1 or later. Uses `m68k-parser` and has no dependency on the language server.

## Workspace development

From the repository root:

```sh
pnpm install
pnpm run build:formatter
node packages/m68k-formatter/cli.js --help
```

The package also builds and tests independently with `pnpm run build` and `pnpm test`
from this directory. `pnpm pack` builds a package containing the JavaScript library,
TypeScript declarations, and CLI. It has not been published yet.

## CLI

```sh
m68k-format source.s
m68k-format --write 'src/**/*.s'
m68k-format --check 'src/**/*.s'
cat source.s | m68k-format
cat source.s | m68k-format --stdin-filepath src/source.s
m68k-format --config formatter.json source.s
m68k-format --init
```

The default output is formatted source on stdout; multiple files are concatenated
in pattern order, with sorted matches and duplicate paths removed. `--write` updates
files in place. `--check` reports files needing formatting on stderr without modifying
them. Exit status is `0` for success, `1` when a check finds changes, and `2` for errors.
Unmatched patterns are errors. Globs exclude `.git` and `node_modules`.

With no file arguments, or `-`, input comes from stdin. Stdin cannot be combined with
files or `--write`. Use `--` before file names beginning with a dash.

## Configuration

```sh
m68k-format --init
```

Asks for case, label colons, quote style, operand spacing, indent style, trailing
whitespace, final newline and line endings, then writes `.m68k-format.json` in the
current directory. Only answers that differ from the defaults are written. It shows
the file and asks before writing, and asks again before overwriting an existing one.
`--init` needs an interactive terminal; write the file by hand otherwise.

The `format` section of a shared `.m68krc.json`, the project config the language servers read, works
too: it holds the same options. The nearest `.m68k-format.json` and the nearest `.m68krc.json` with a
`format` section are both loaded and merged, whichever is nearer taking precedence (the `.m68k-format.json`
where they share a directory), so the CLI reads what the language server does. A `.m68krc.json` without a
`format` section is passed over.

Both the CLI and the language server discover the nearest `.m68k-format.json`,
searching upwards from the source file's directory. Stdin searches from the working
directory, or from `--stdin-filepath` when supplied. `--config` overrides discovery.
Only the nearest file of each kind is used; further ancestors are not merged.

A JSON schema for the file is published as `m68k-format.schema.json` in this package
and bundled with the VS Code extension. Elsewhere, reference it with `$schema`:
`"$schema": "https://cdn.jsdelivr.net/npm/m68k-formatter@0/m68k-format.schema.json"`.

The file contains formatter options directly, without a `format` wrapper:

```json
{
  "case": "lower",
  "labelColon": "on",
  "quotes": "double",
  "operandSpace": "off",
  "align": {
    "mnemonic": 8,
    "operands": 16,
    "comment": 48,
    "indentConditional": 4,
    "indentRept": 4,
    "indentMacro": 4
  }
}
```

Missing options use the library defaults. In the language server, file options
override `m68k.format` settings; explicit formatting-request options, including the
editor's tab size and spaces/tabs choice, take precedence. Invalid JSON, unknown
options, and invalid values are errors.

## Library

```ts
import { format, formatEdits } from "m68k-formatter";

const source = " MOVE.W D0,D1";
const formatted = format(source, { case: "lower" });
const edits = formatEdits(source, { case: "lower" });
```

`format` returns a string. `formatEdits` returns LSP-compatible edits against the
original source, using zero-based UTF-16 positions. Its optional third argument is
a range; block nesting outside that range is still taken into account.

Both functions merge supplied options with `defaultOptions`. They perform no file
I/O or configuration discovery. `findConfig(directory)` and `loadConfig(path)` are
available when an application wants the CLI's discovery behavior.

`DocumentFormatter` is the lower-level API used by the language server. It accepts
explicit options (without adding defaults), then formats `{ text, parsed }`, allowing
reuse of an existing `m68k-parser` parse. `mergeOptions` merges option objects and
their `align` fields without mutating them.

## Options

| Option           | Default    | Values                                                                                                                   |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `case`           | `"lower"`  | `"lower"`, `"upper"`, `"any"`, or an object with `instruction`, `directive`, `control`, `register`, `sectionType`, `hex` |
| `labelColon`     | `"on"`     | `"on"`, `"off"`, `"notInline"`, `"onlyInline"`, `"any"`, or an object with `global` and `local`                          |
| `quotes`         | `"double"` | `"double"`, `"single"`, `"any"`                                                                                          |
| `operandSpace`   | `"off"`    | `"on"`, `"off"`, `"any"`                                                                                                 |
| `trimWhitespace` | `false`    | Remove trailing whitespace                                                                                               |
| `finalNewLine`   | `true`     | Add/remove the final newline                                                                                             |
| `endOfLine`      | `"lf"`     | `"lf"`, `"crlf"`, `"cr"`                                                                                                 |

Alignment options are under `align`. Positions and block widths are nonnegative
column counts. Labels remain in column zero.

| Option                                           | Default     | Meaning                                                                      |
| ------------------------------------------------ | ----------- | ---------------------------------------------------------------------------- |
| `mnemonic`                                       | `8`         | Instruction/directive position                                               |
| `operands`                                       | `16`        | Operand position                                                             |
| `comment`                                        | `48`        | Inline comment position                                                      |
| `operator`                                       | `0`         | Assignment `=` position                                                      |
| `value`                                          | `0`         | Assignment value position                                                    |
| `indentConditional`, `indentRept`, `indentMacro` | `0`         | Additional body indentation; nested widths add together                      |
| `indentStyle`                                    | `"space"`   | `"space"` or `"tab"`                                                         |
| `tabSize`                                        | `8`         | Positive tab width in columns                                                |
| `autoExtend`                                     | `"line"`    | Extend alignment for a `"line"`, blank-line-separated `"block"`, or `"file"` |
| `standaloneComment`                              | `"nearest"` | `"ignore"`, `"nearest"`, `"label"`, another element name, or a column number |

Block openers, alternatives, and closers align at the enclosing level. Aligned
comments shift with the code; comments in column zero remain untouched.

## Module formats

ESM imports and CommonJS `require` are supported through conditional exports, with matching TypeScript declarations. Existing CommonJS file paths remain available. ESM consumers receive the native `.mjs` entry point.
