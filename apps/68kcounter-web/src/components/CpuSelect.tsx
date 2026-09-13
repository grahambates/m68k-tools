import { type FC } from "react";
import { type CacheModel, CacheModels, type Cpu, Cpus } from "68kcounter";
import "./CpuSelect.css";

export interface CpuSelectProps {
  cpu: Cpu;
  cacheModel: CacheModel;
  onCpuChange: (cpu: Cpu) => void;
  onCacheModelChange: (cacheModel: CacheModel) => void;
}

const cacheModelLabels: Record<CacheModel, string> = {
  [CacheModels.Worst]: "Worst case",
  [CacheModels.Cache]: "Cache hit",
};

export const CpuSelect: FC<CpuSelectProps> = ({
  cpu,
  cacheModel,
  onCpuChange,
  onCacheModelChange,
}) => (
  <div className="CpuSelect">
    <label className="CpuSelect__field">
      CPU
      <select value={cpu} onChange={(e) => onCpuChange(e.target.value as Cpu)}>
        {Object.values(Cpus).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
    {cpu === Cpus.MC68020 && (
      <label className="CpuSelect__field">
        Cache
        <select
          value={cacheModel}
          onChange={(e) => onCacheModelChange(e.target.value as CacheModel)}
        >
          {Object.values(CacheModels).map((value) => (
            <option key={value} value={value}>
              {cacheModelLabels[value]}
            </option>
          ))}
        </select>
      </label>
    )}
  </div>
);
