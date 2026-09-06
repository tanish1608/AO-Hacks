'use client';
import type { TrendPoint } from '@/lib/workbench/metrics';
/**
 * Hand-drawn SVG rather than a chart library: the product surface is plain CSS,
 * these are three small shapes, and the main route is already heavy.
 */
const W = 300,
  H = 74,
  PAD = 8;
function path(values: number[], max: number) {
  if (values.length < 2) return '';
  const span = max || 1;
  return values
    .map((v, i) => {
      const x = PAD + (i * (W - PAD * 2)) / (values.length - 1);
      const y = H - PAD - (v / span) * (H - PAD * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
export function TrendLine({
  points,
  accessor,
  max,
  target,
  label,
  format,
}: {
  points: TrendPoint[];
  accessor: (p: TrendPoint) => number | null;
  max: number;
  target?: number;
  label: string;
  format: (v: number) => string;
}) {
  const values = points.map((p) => accessor(p) ?? 0);
  const last = values.at(-1);
  const targetY =
    target === undefined
      ? null
      : H - PAD - (target / (max || 1)) * (H - PAD * 2);
  return (
    <figure className="trend-chart">
      <figcaption>
        <span>{label}</span>
        <strong>{last === undefined ? '—' : format(last)}</strong>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`}>
        <title>{label}</title>
        {targetY !== null && (
          <line
            x1={PAD}
            x2={W - PAD}
            y1={targetY}
            y2={targetY}
            className="trend-target"
          />
        )}
        {values.length > 1 && <path d={path(values, max)} className="trend-line" />}
        {points.map((p, i) => {
          const x =
            values.length > 1
              ? PAD + (i * (W - PAD * 2)) / (values.length - 1)
              : W / 2;
          const y = H - PAD - ((accessor(p) ?? 0) / (max || 1)) * (H - PAD * 2);
          return (
            <circle
              key={p.runId}
              cx={x}
              cy={y}
              r={3}
              // Memory-off runs are hollow, so an ablation reads at a glance.
              className={`trend-dot ${p.useMemory ? 'with-memory' : 'without-memory'}`}
            >
              <title>{`${format(accessor(p) ?? 0)}${p.useMemory ? '' : ' · memory off'}`}</title>
            </circle>
          );
        })}
      </svg>
    </figure>
  );
}
export function PairedBars({
  label,
  memory,
  control,
  format,
  lowerIsBetter = false,
}: {
  label: string;
  memory: number | null;
  control: number | null;
  format: (v: number) => string;
  lowerIsBetter?: boolean;
}) {
  const max = Math.max(memory ?? 0, control ?? 0) || 1;
  const bar = (value: number | null, name: string, cls: string) => (
    <div className="paired-bar">
      <span>{name}</span>
      <div>
        <i className={cls} style={{ width: `${((value ?? 0) / max) * 100}%` }} />
      </div>
      <strong>{value === null ? 'Unpriced' : format(value)}</strong>
    </div>
  );
  return (
    <div className="paired-bars">
      <span className="paired-label">
        {label}
        {lowerIsBetter && <small>lower is better</small>}
      </span>
      {bar(memory, 'Memory on', 'with-memory')}
      {bar(control, 'Memory off', 'without-memory')}
    </div>
  );
}
