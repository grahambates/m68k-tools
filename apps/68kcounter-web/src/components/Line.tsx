import { memo, useState } from "react";
import { Timing } from "./Timing";
import { LineTotals } from "./LineTotals";
import { Bytes } from "./Bytes";
import "./Line.css";
import {
  type Line as LineType,
  type Timing as TimingType,
  Mnemonics,
  timingReferenceDescription,
  type Totals,
} from "68kcounter";

export interface LineProps {
  isSelected: boolean;
  onHover: (index: number) => void;
  onClick: (index: number) => void;
  onClearSelection: () => void;
  line: LineType;
  index: number;
  totals: Totals | null;
}

export const Line = memo<LineProps>(
  ({ isSelected, onHover, onClick, onClearSelection, line, index, totals }) => {
    const isMultiple = line.timing && line.timing.values.length > 1;
    const hasEa =
      line.timing?.calculation?.ea && line.timing.calculation.ea[0] > 0;
    const hasMultiplier = line.timing?.calculation?.multiplier;
    const isCalculated = hasEa || hasMultiplier;
    const hasDetail =
      isCalculated ||
      isMultiple ||
      line.timing?.reference ||
      line.timing?.groups;

    const [expanded, setExpanded] = useState(false);
    return (
      <>
        {totals && (
          <LineTotals totals={totals} onClearSelection={onClearSelection} />
        )}
        <div
          className={"Line " + (isSelected ? "selected" : "")}
          onClick={() => onClick(index)}
          onMouseEnter={() => onHover(index)}
        >
          <div className="Line__info">
            <div className="Line__infoItems">
              {hasDetail && (
                <div className="Line__toggleWrapper">
                  <button
                    className="Line__toggle"
                    onClick={(e) => {
                      setExpanded(!expanded);
                      e.stopPropagation();
                    }}
                  >
                    {expanded ? "-" : "+"}
                  </button>
                </div>
              )}
              {line.timingUnavailable && (
                <span title={line.timingUnavailable}>?</span>
              )}
              {line.timing?.groups && line.timing.groups.length > 1 ? (
                <span>Mixed timing models</span>
              ) : (
                line.timing &&
                line.timing.values.map((t, i) => (
                  <Timing timing={t} key={i} color />
                ))
              )}
              {!!line.bytes && <Bytes bytes={line.bytes} color />}
            </div>
            {hasDetail && line.timing && (
              <div className={"Line__detail" + (expanded ? " expanded" : "")}>
                <div className="Line__detailContent">
                  {line.timing.reference && (
                    <div>{timingReferenceDescription(line.timing)}</div>
                  )}
                  {line.timing.reference?.note && (
                    <div>{line.timing.reference.note}</div>
                  )}
                  {line.timing.reference?.stages && (
                    <div>
                      EA calculate: {line.timing.reference.stages.calculate};
                      execute: {line.timing.reference.stages.executeLead} lead +{" "}
                      {line.timing.reference.stages.executeBase} base.
                    </div>
                  )}
                  {isMultiple &&
                    line.timing.values.map((t, i) => (
                      <div key={i}>
                        <span className="Line__detailLabel">
                          {line.timing!.labels![i]}:
                        </span>
                        {formatTiming(t)}
                      </div>
                    ))}
                  {(hasMultiplier || hasEa) && (
                    <div>
                      {formatTiming(
                        line.timing.calculation!.base[0],
                        line.timing.calculation!.multiplier,
                      )}
                    </div>
                  )}
                  {hasMultiplier && (
                    <div>n = {line.timing.calculation?.n ?? "unknown"}</div>
                  )}
                  {hasEa && (
                    <div>
                      <span className="Line__detailLabel">+ EA:</span>
                      {formatTiming(line.timing.calculation!.ea!)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="Line__content">
            <span className="Line__number">{index + 1}</span>
            <pre
              className="Line__code"
              dangerouslySetInnerHTML={{
                __html: formatLine(line.statement.text),
              }}
            />
          </div>
        </div>
      </>
    );
  },
);

Line.displayName = "Line";

const mnemExp = new RegExp(
  `(?<![;*])(?<=\\s|:)((${Object.values(Mnemonics).join(
    "|",
  )}|blo|dblo|dbra)(\\.(b|w|l|s))?)\\b`,
  "i",
);
const labelExp = /^([^\s;*]+)/;
const commentExp = /((;|\s\*|^\*).*)/;

const formatLine = (line: string) => {
  const labelMatch = line.match(labelExp);
  const mnemMatch = line.match(mnemExp);
  const commentMatch = line.match(commentExp);
  if (labelMatch) {
    line = line.replace(labelExp, '<span class="Line__label">$1</span>');
  }
  if (mnemMatch) {
    line = line.replace(mnemExp, '<span class="Line__mnem">$1</span>');
  }
  if (commentMatch) {
    line = line.replace(commentExp, '<span class="Line__comment">$1</span>');
  }
  return line;
};

const formatTiming = (timing: TimingType, multiplier?: TimingType) => {
  const strVals = timing.map((v) => String(v));

  if (multiplier) {
    for (const i in multiplier) {
      if (multiplier[i]) {
        strVals[i] += "+" + multiplier[i] + "n";
      }
    }
  }

  // 68000 timings are [clocks, reads, writes]; 68020 timings add a
  // prefetch count: [clocks, reads, prefetches, writes].
  return `${strVals[0]}(${strVals.slice(1).join("/")})`;
};
