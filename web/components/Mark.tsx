interface MarkProps {
  height?: number;
  className?: string;
}

export default function Mark({ height = 24, className }: MarkProps) {
  const width = (height * 20) / 24;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 20 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <polygon points="0,0 5,0 20,0 20,5 10,9 5,8.5 0,8" />
      <polygon points="0,10 0,24 5,24 20,24 20,17 5,11 5,10.5" />
    </svg>
  );
}
