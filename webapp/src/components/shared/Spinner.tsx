export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin text-amber"
      aria-label="Loading"
    >
      <circle
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray="50 14"
        strokeLinecap="round"
        opacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 8.66 5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
