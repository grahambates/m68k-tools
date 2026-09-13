import { type FC } from "react";
import { type Totals } from "68kcounter";
import { Timing } from "./Timing";
import { Bytes } from "./Bytes";
import "./LineTotals.css";

export interface LineTotalsProps {
  totals: Totals;
  onClearSelection: () => void;
}

export const LineTotals: FC<LineTotalsProps> = ({
  totals: { min, max, isRange, bytes },
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
    {isRange ? (
      <span>
        <Timing timing={min} />–<Timing timing={max} />
      </span>
    ) : (
      <Timing timing={min} />
    )}
    <Bytes bytes={bytes} />
  </div>
);
