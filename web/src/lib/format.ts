const dateTime = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const dateOnly = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});

export const fmtDateTime = (value?: string | null) => (value ? dateTime.format(new Date(value)) : '—');
export const fmtTime = (value?: string | null) => (value ? timeOnly.format(new Date(value)) : '—');
export const fmtDate = (value?: string | null) => (value ? dateOnly.format(new Date(value)) : '—');

export function fmtRelative(value?: string | null) {
  if (!value) return '—';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return fmtDateTime(value);
}

/** For <input type="datetime-local">, which wants local time with no zone. */
export function toLocalInput(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export const pluralize = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
