import { fmtTime } from '../lib/format';

/** Check-ins per time bucket. Hand-drawn so it keeps the hairline language. */
export function TimelineChart({ data }: { data: { at: string; count: number }[] }) {
  if (!data.length) return <p className="meta">No check-ins recorded yet.</p>;
  const peak = Math.max(...data.map((point) => point.count), 1);

  return (
    <div className="chart">
      <div className="chart__bars" role="img" aria-label={`Check-ins over time, peak ${peak} in one interval`}>
        {data.map((point) => (
          <div
            key={point.at}
            className="chart__bar"
            style={{ height: `${Math.max((point.count / peak) * 100, 2)}%` }}
            title={`${fmtTime(point.at)} — ${point.count} checked in`}
          />
        ))}
      </div>
      <div className="chart__axis">
        <span className="stamp">{fmtTime(data[0].at)}</span>
        <span className="stamp">peak {peak}</span>
        <span className="stamp">{fmtTime(data[data.length - 1].at)}</span>
      </div>
    </div>
  );
}

export function BarList({ rows }: { rows: { label: string; count: number }[] }) {
  if (!rows.length) return <p className="meta">Nothing recorded yet.</p>;
  const peak = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div>
      {rows.map((row) => (
        <div className="hbar" key={row.label}>
          <span className="stamp truncate" title={row.label}>
            {row.label.replace(/_/g, ' ')}
          </span>
          <span className="hbar__track">
            <span className="hbar__fill" style={{ width: `${(row.count / peak) * 100}%` }} />
          </span>
          <span className="hbar__value">{row.count}</span>
        </div>
      ))}
    </div>
  );
}
