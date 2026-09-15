/**
 * Formatter implementations for CLI output
 */

import chalk, { type Color } from "chalk";

import { formatTiming, type Level, Levels, timingLevel } from ".";
import { type Timing } from "./timings";
import { type Line } from "./parse";
import { formatTotalsTiming, type Totals } from "./totals";

export interface IncludedElements {
  text: boolean;
  timings: boolean;
  bytes: boolean;
  totals: boolean;
}

export interface Formatter {
  format(lines: Line[], totals: Totals): string;
}

export interface JsonOptions {
  /** Pretty print JSON with whtespace */
  prettyPrint: boolean;
  /** Elements to include in output */
  include: IncludedElements;
}

export interface PlainTextOptions {
  /** Color text output in terminal */
  color: boolean;
  /** Elements to include in output */
  include: IncludedElements;
  /** Width of annotation column */
  width: number;
}

export class JsonFormatter implements Formatter {
  constructor(private options: JsonOptions) {}

  format(lines: Line[], totals: Totals): string {
    const inc = this.options.include;

    const output = {
      lines:
        inc.text || inc.timings || inc.bytes
          ? lines.map((l) => ({
              text: inc.text ? l.statement.text : undefined,
              timing: inc.timings ? l.timing : undefined,
              timingUnavailable: inc.timings ? l.timingUnavailable : undefined,
              bytes: inc.bytes ? l.bytes : undefined,
              // Flag lines shown for reference only (excluded from totals)
              reference: l.reference || undefined,
            }))
          : undefined,
      totals: inc.totals ? totals : undefined,
    };

    return this.options.prettyPrint
      ? JSON.stringify(output, null, 2)
      : JSON.stringify(output);
  }
}

export class PlainTextFormatter implements Formatter {
  constructor(private options: PlainTextOptions) {}

  static levelToColor: Record<Level, typeof Color> = {
    [Levels.VHigh]: "bgRed",
    [Levels.High]: "red",
    [Levels.Med]: "yellow",
    [Levels.Low]: "green",
  };

  format(lines: Line[], totals: Totals): string {
    const inc = this.options.include;

    let output: string[] = [];

    if (inc.text || inc.timings || inc.bytes) {
      output = lines.map((l) => {
        let annotation = "";
        if (l.timing && inc.timings) {
          const format = this.options.color
            ? this.formatTimingColored
            : formatTiming;
          annotation +=
            l.timing.groups && l.timing.groups.length > 1
              ? "Mixed timing models"
              : l.timing.values.map(format).join(" / ");
        }
        if (l.bytes && inc.bytes) {
          annotation += " " + this.formatNumber(l.bytes);
        }
        annotation = this.pad(annotation, this.options.width);
        if (inc.text) {
          annotation += " | " + l.statement.text;
        }
        return annotation;
      });
    }

    if (inc.totals) {
      output.push("\nTotals:");
      if (totals.timingGroups) {
        output.push(formatTotalsTiming(totals));
      } else if (totals.isRange) {
        output.push(
          formatTiming(totals.min) + " - " + formatTiming(totals.max),
        );
      } else {
        output.push(formatTiming(totals.min));
      }
      output.push(
        `${this.formatNumber(totals.bytes)} bytes (${this.formatNumber(
          totals.objectBytes,
        )} object, ${this.formatNumber(totals.bssBytes)} BSS)`,
      );
    }

    if (
      inc.timings &&
      lines.some((l) => l.timing?.reference || l.timing?.groups)
    )
      output.push(
        "Cached reference costs, not elapsed sequence timings. Parentheses count operand accesses, not external bus transfers. 68040 uses execution-stage lead + base; 68060 excludes pairing.",
      );
    if (inc.timings && lines.some((l) => l.timingUnavailable))
      output.push(
        "Some instruction forms have no cached timing and are excluded from timing totals.",
      );
    return output.join("\n");
  }

  private formatTimingColored(timing: Timing) {
    const output = formatTiming(timing);
    const level = timingLevel(timing);
    return chalk[PlainTextFormatter.levelToColor[level]](output);
  }

  /**
   * Display a string with padding
   */
  private pad(str: string, l: number) {
    /*eslint-disable no-control-regex */
    const strClean = str.replace(/(\x9B|\x1B\[)[0-?]*[ -/]*[@-~]/g, "");
    const p = l - strClean.length;
    return p > 0 ? Array(p).fill(" ").join("") + str : str;
  }

  private formatNumber(num: number): string {
    return num.toLocaleString("en");
  }
}
