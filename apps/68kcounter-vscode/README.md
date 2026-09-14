# 68k Counter for VS Code

Displays cycle and size information for 68000, 68020 and 68030 assembly source.

## Features

### Gutter annotations

![Output window screenshot](images/demo.gif)

Provides annotations for each line of code to show:

- Size in bytes
- CPU cycles
- Bus read cycles
- Instruction prefetch cycles (68020/68030)
- Bus write cycles

Click 'Toggle counts' at the top of a file to enable these. These counts live-update as you edit the code.

### Calculate totals

Totals cycles and size across a range of lines. Either:

- Select some text with count annotations enabled and the totals will be displayed in the status bar at the bottom of the screen.

  ![Selection counts](images/selection.png)

- Call `68kcounter: Count selection` from the command palette with some text selected.

## Requirements

An extension which provides a 68000 assembly language definition:

- [Amiga Assembly](https://marketplace.visualstudio.com/items?itemName=prb28.amiga-assembly)
- [m68k](https://marketplace.visualstudio.com/items?itemName=steventattersall.m68k)
- [Motorola 68k Assembly](https://marketplace.visualstudio.com/items?itemName=clcxce.motorola-68k-assembly)

Requires VS Code 1.101 or later. This extension currently uses the published counter 3.x library; the workspace counter upgrade is a separate application change.

## Development

Install dependencies at the monorepo root and choose **Counter: Extension** in Run and Debug. `pnpm package:counter` creates the VSIX through a staging directory, preserving the Marketplace identity `gigabates.68kcounter`.

## License

[MIT](LICENSE); existing attribution notices are preserved.

## CPU and cache settings

Set project defaults in `.vscode/settings.json`:

```json
{
  "68kcounter.defaultCpu": "68020",
  "68kcounter.cacheModel": "worst"
}
```

The default CPU is `68000`. Supported `machine` directives in the source override it, including directives before a counted selection. Settings are scoped to the document's workspace folder.

Choose `worst` or `cache` for uncached or cached timings. Run **68kcounter: Toggle cache timing model**, or click the counts in the status bar, to switch modes temporarily for the current document. Annotations and selection counts update immediately without changing settings. The override lasts until the document closes or you run **68kcounter: Reset cache timing model to configured default**. Other documents keep their own mode. The cache setting has no effect on 68000 timings.

Timings are displayed as `clocks(reads/writes)` for 68000 and `clocks(reads/prefetches/writes)` for 68020/68030. Hover over an annotation for the column legend and active cache model. Currently only 68000, 68020 and 68030 timing data are supported; 68040/060 are not selectable yet.

For 68030, uncached values are the manual's average no-cache estimates with two-clock reads and writes, not absolute worst cases. Instruction overlap, data-cache hits, MMU walks, wait states and full-format addressing are not simulated. See the [core timing documentation](../../packages/68kcounter/README.md) for coverage.
