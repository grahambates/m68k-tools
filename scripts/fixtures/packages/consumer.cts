/* eslint-disable @typescript-eslint/no-require-imports -- Exercises the published CommonJS declarations. */
import counter = require("68kcounter");
import formatter = require("m68k-formatter");
const bytes: number = counter.calculateTotals(counter.default("  nop")).bytes;
const text: string = formatter.format(" NOP");
void [bytes, text];
