import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import {
  type CacheModel,
  calculateTotals,
  type Cpu,
  Cpus,
  defaultCacheModel,
  defaultCpu,
  type Line as LineType,
  type Totals as TotalsType,
} from "68kcounter";
import { parse } from "../parse";
import "./App.css";
import { Form } from "./Form";
import { Github } from "./icons/Github";
import { Logo } from "./icons/Logo";
import { VsCode } from "./icons/VsCode";
import { Line } from "./Line";
import { Totals } from "./Totals";
import { CpuSelect } from "./CpuSelect";

interface Selection {
  start: number | null;
  end: number | null;
  hover: number | null;
  totals: TotalsType | null;
}

const defaultSelection: Selection = {
  start: null,
  end: null,
  hover: null,
  totals: null,
};

export const App: FC = () => {
  const [code, setCode] = useState("");
  const [cpu, setCpu] = useState<Cpu>(defaultCpu);
  const [cacheModel, setCacheModel] = useState<CacheModel>(defaultCacheModel);
  const [selection, setSelection] = useState<Selection>(defaultSelection);

  const lines = useMemo(
    () => (code ? parse(code, { cpu, cacheModel }) : null),
    [code, cpu, cacheModel],
  );
  const totals = useMemo(
    () => (lines ? calculateTotals(lines) : null),
    [lines],
  );
  // 68000 bus cycles are [reads, writes]; 68020 adds a prefetch count:
  // [reads, prefetches, writes].
  const busCycles = totals?.timingGroups
    ? "operand reads/writes; see model labels"
    : lines?.some((line) =>
          line.timing?.values.some((value) => value.length === 4),
        ) ||
        cpu === Cpus.MC68020 ||
        cpu === Cpus.MC68030
      ? "reads/prefetches/writes"
      : "reads/writes";

  const handleSubmit = (code: string) => {
    setCode(code);
    setSelection(defaultSelection);
    setTimeout(() => {
      document
        .getElementById("results")
        ?.scrollIntoView({ behavior: "smooth" });
    }, 10);
  };

  const handleCpuChange = (value: Cpu) => {
    setCpu(value);
    setSelection(defaultSelection);
  };

  const handleCacheModelChange = (value: CacheModel) => {
    setCacheModel(value);
    setSelection(defaultSelection);
  };

  const clearSelection = useCallback(() => {
    setSelection((s) => ({ ...s, start: null, end: null, totals: null }));
  }, []);

  const handleClick = useCallback(
    (i: number) => {
      setSelection((s) => {
        if (s.start !== null && s.end === null) {
          if (i === s.start) {
            // Cancel selection if clicking the start row again
            return { ...s, start: null, end: null, hover: null };
          }
          // Finish selection
          const min = Math.min(i, s.start);
          const max = Math.max(i, s.start);
          const range = (lines as LineType[]).slice(min, max + 1);
          return {
            ...s,
            start: min,
            end: max,
            hover: null,
            totals: calculateTotals(range),
          };
        }
        // Start new selection
        return { start: i, end: null, hover: null, totals: null };
      });
    },
    [lines],
  );

  const handleHover = useCallback((i: number) => {
    setSelection((s) => ({ ...s, hover: i }));
  }, []);

  // Clear selection on escape
  useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, [clearSelection]);

  return (
    <div className="App">
      <div className="App__header">
        <div>
          <div className="App__logo">
            <Logo size="300" />
          </div>
          <div className="App__intro">
            <p>
              Analyses 68000 assembly source to show cycle timings and
              instruction sizes.
            </p>
            <div className="App__links">
              <VsCode />
              <a href="https://marketplace.visualstudio.com/items?itemName=gigabates.68kcounter">
                VS Code extension
              </a>
              <Github />
              <a href="https://github.com/grahambates/68kcounter">
                JS package + CLI tool
              </a>{" "}
            </div>
          </div>
        </div>

        <Form onSubmit={handleSubmit} />
      </div>

      {lines && (
        <div id="results">
          <div className="App__resultsHeader">
            {totals && <Totals totals={totals} />}
            <CpuSelect
              cpu={cpu}
              cacheModel={cacheModel}
              onCpuChange={handleCpuChange}
              onCacheModelChange={handleCacheModelChange}
            />

            <div className="App__help">
              <ul>
                <li>
                  Data is shown in the format:{" "}
                  <code>cycles({busCycles}) bytes</code>
                </li>
                <li>
                  Some timings can be expanded to show how they&apos;re
                  calculated
                </li>
                <li>
                  Click to select a range of lines and calculate totals for a
                  section of code.
                </li>
              </ul>
            </div>
          </div>

          {lines.map((line, i) => {
            const a = selection.start;
            const b = selection.end !== null ? selection.end : selection.hover;
            const isSelected =
              a !== null &&
              b !== null &&
              i >= Math.min(a, b) &&
              i <= Math.max(a, b);

            return (
              <Line
                key={i + line.statement.text}
                line={line}
                index={i}
                totals={i === selection.start ? selection.totals : null}
                isSelected={isSelected}
                onHover={handleHover}
                onClick={handleClick}
                onClearSelection={clearSelection}
              />
            );
          })}
        </div>
      )}
      <div className="App__footer">&copy; 2021 Graham Bates</div>
    </div>
  );
};
