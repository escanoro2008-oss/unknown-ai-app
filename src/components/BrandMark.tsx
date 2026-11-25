interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 28, className = '' }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <rect
        width="32"
        height="32"
        rx="8"
        className="fill-slate-900 dark:fill-slate-100"
      />
      <path
        d="M10.25 10.5V16.75C10.25 19.9256 12.8244 22.5 16 22.5C19.1756 22.5 21.75 19.9256 21.75 16.75V10.5"
        className="stroke-white dark:stroke-slate-900"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="16" cy="10.5" r="2" className="fill-blue-500 dark:fill-blue-600" />
    </svg>
  );
}
