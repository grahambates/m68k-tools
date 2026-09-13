import { type FC } from "react";
import { type Totals as TotalsType } from "68kcounter";
import { Timing } from "./Timing";
import { Bytes } from "./Bytes";
import "./Totals.css";

export interface TotalsProps {
  totals: TotalsType;
}

export const Totals: FC<TotalsProps> = ({ totals }) => (
  <div className="Totals">
    <div>
      <p>
        <div>
          <strong>Total cycles: </strong>
        </div>
        {totals.isRange ? (
          <>
            <Timing timing={totals.min} /> – <Timing timing={totals.max} />
          </>
        ) : (
          <Timing timing={totals.min} />
        )}
      </p>
      <p>
        <div>
          <strong>Total length: </strong>
        </div>
        <Bytes bytes={totals.bytes} /> bytes)
      </p>
    </div>
  </div>
);
