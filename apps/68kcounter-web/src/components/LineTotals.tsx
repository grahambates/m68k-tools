import { type FC } from "react";
import { formatTotalsTiming, type Totals } from "68kcounter";
import { Timing } from "./Timing";
import { Bytes } from "./Bytes";
import "./LineTotals.css";

export interface LineTotalsProps {
  totals: Totals;
  onClearSelection: () => void;
}

export const LineTotals: FC<LineTotalsProps> = ({
  totals,
  onClearSelection,
}) => (
  <div className="LineTotals">
    <button
      className="LineTotals__clear"
      onClick={(e) => {
        onClearSelection();
        e.stopPropagation();
      }}
    >
      &times;
    </button>

    <strong>Total:</strong>
    {totals.timingGroups ? (
      <span>{formatTotalsTiming(totals)} (reference sums)</span>
    ) : totals.isRange ? (
      <span>
        <Timing timing={totals.min} />–<Timing timing={totals.max} />
      </span>
    ) : (
      <Timing timing={totals.min} />
    )}
    {totals.incomplete && <span>Incomplete timings</span>}
    <Bytes bytes={totals.bytes} />
  </div>
);
