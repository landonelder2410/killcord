import type { SVGProps } from 'react';

// Broken circuit mark — two segments with a clean gap.
// Uses currentColor so the caller controls fill via CSS `color`.
// viewBox crops tight to the bars (y 8–24) for a 2:1 aspect ratio,
// which lets the mark sit comfortably beside or above text without
// carrying the whitespace of the square favicon viewBox.
export function BrokenCircuit(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 8 32 16"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="2"  y="14" width="11" height="4" rx="1.5" fill="currentColor" />
      <rect x="19" y="14" width="11" height="4" rx="1.5" fill="currentColor" />
    </svg>
  );
}
