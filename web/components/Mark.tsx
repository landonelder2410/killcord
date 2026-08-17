export function Mark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none"
         className={className} aria-hidden="true">
      <rect x="14" y="10" width="18" height="80" fill="currentColor" />
      <path d="M86 10 L52 50 L86 90" stroke="currentColor" strokeWidth="18"
            strokeLinejoin="miter" fill="none" />
    </svg>
  );
}
