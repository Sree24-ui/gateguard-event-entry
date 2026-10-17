/**
 * The mark: a scanner viewfinder with a gate post standing in the middle.
 * Square cuts only, one stroke weight, legible at 16px — it has to read on a
 * phone in sunlight as well as in the browser tab.
 */
export function Mark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path
        d="M2 7.5V2h5.5M16.5 2H22v5.5M22 16.5V22h-5.5M7.5 22H2v-5.5"
        stroke="currentColor"
        strokeWidth="2.25"
      />
      <rect x="10.9" y="6" width="2.2" height="12" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ '--mark-size': `${size}px` } as React.CSSProperties}>
      <Mark size={size} />
      <span className="wordmark__text">
        Gate<span className="wordmark__half">Guard</span>
      </span>
    </span>
  );
}
