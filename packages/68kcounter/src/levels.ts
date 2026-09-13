import { type Timing } from "./timings";

export type Level = "vhigh" | "high" | "med" | "low";

/**
 * Warning level timing/length display
 */
export const Levels = {
  VHigh: "vhigh",
  High: "high",
  Med: "med",
  Low: "low",
} as const;

/**
 * Get warning level for timing
 */
export function timingLevel(timing: Timing): Level {
  if (timing[0] > 30) {
    return Levels.VHigh;
  }
  if (timing[0] > 20) {
    return Levels.High;
  }
  if (timing[0] >= 12) {
    return Levels.Med;
  }
  return Levels.Low;
}

/**
 * Get warning level for byte length
 */
export function lengthLevel(bytes: number): Level {
  if (bytes > 6) {
    return Levels.VHigh;
  }
  if (bytes > 4) {
    return Levels.High;
  }
  if (bytes === 4) {
    return Levels.Med;
  }
  return Levels.Low;
}
