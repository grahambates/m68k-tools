import counter, { calculateTotals } from "68kcounter";
import { format } from "m68k-formatter";
const bytes: number = calculateTotals(counter("  nop")).bytes;
const text: string = format(" NOP");
void [bytes, text];
