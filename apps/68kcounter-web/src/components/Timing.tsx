import { type FC } from "react";
import {
  formatTiming,
  type Timing as TimingType,
  timingLevel,
} from "68kcounter";

export interface TimingProps {
  timing: TimingType;
  color?: boolean;
}

export const Timing: FC<TimingProps> = ({ timing, color }) => {
  const className = color ? timingLevel(timing).toLowerCase() : "";
  return <span className={"Timing " + className}>{formatTiming(timing)}</span>;
};
