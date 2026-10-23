import type { EventStats } from '../lib/types';
import { fmtRelative } from '../lib/format';

/**
 * The live headcount. One band divided by vertical hairlines — never four
 * floating cards. Values are monospace tabular so the digits do not jitter
 * while the numbers tick up.
 */
export function Metrics({ stats, compact = false }: { stats?: EventStats; compact?: boolean }) {
  if (!stats) {
    return (
      <div className="metrics" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="metric" key={i}>
            <span className="skeleton skeleton--line" style={{ width: 64 }} />
            <span className="skeleton skeleton--metric" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="metrics">
      <Metric label="Registered" value={stats.registered} />
      <Metric
        label="Checked in"
        value={stats.checkedIn}
        sub={stats.lastCheckInAt ? `last ${fmtRelative(stats.lastCheckInAt)}` : 'nobody yet'}
      />
      <Metric label="Remaining" value={stats.remaining} />
      <Metric label="Attendance" value={stats.attendancePct} suffix="%" />
      {(stats.exitsRecorded || stats.occupancyLimit > 0) && (
        <Metric
          label="Inside now"
          value={stats.inside}
          sub={
            stats.exitsRecorded
              ? stats.occupancyLimit
                ? `of ${stats.occupancyLimit} safe limit`
                : 'recorded'
              : 'no exits scanned yet'
          }
          warn={stats.occupancyLimit > 0 && stats.occupancyPct >= 85}
        />
      )}
      {!compact && stats.conflicts > 0 && (
        <Metric label="Conflicts" value={stats.conflicts} sub="offline scans to review" warn />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
  sub,
  warn
}: {
  label: string;
  value: number;
  suffix?: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="metric">
      <span className="stamp metric__label">{label}</span>
      <span className="metric__value" style={warn ? { color: 'var(--amber)' } : undefined}>
        {value.toLocaleString()}
        {suffix && <sup>{suffix}</sup>}
      </span>
      {sub && <span className="metric__sub">{sub}</span>}
    </div>
  );
}

export function AttendanceBar({ stats }: { stats: EventStats }) {
  return (
    <div
      className="bar"
      role="progressbar"
      aria-valuenow={stats.attendancePct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${stats.checkedIn} of ${stats.registered} attendees checked in`}
    >
      <div className="bar__fill" style={{ width: `${Math.min(stats.attendancePct, 100)}%` }} />
    </div>
  );
}
