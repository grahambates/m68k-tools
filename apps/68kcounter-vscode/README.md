# 68k Counter for VS Code

Displays cycle and size information for 68000 assembly source.

## Features

### Gutter annotations

![Output window screenshot](images/demo.gif)

Provides annotations for each line of code to show:

- Size in words
- CPU cycles
- Bus read cycles
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
