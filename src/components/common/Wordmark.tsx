import { useId } from 'react';

/**
 * The inflow wordmark: "in" in the foreground color, "flow" in a blue→violet
 * gradient. `collapsed` renders a compact gradient "f".
 */
export function Wordmark({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  if (collapsed) {
    return (
      <span
        className={`select-none bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text font-extrabold text-transparent ${className ?? 'text-lg'}`}
      >
        f
      </span>
    );
  }
  return (
    <span className={`select-none font-extrabold lowercase tracking-tight ${className ?? 'text-[16px]'}`}>
      <span className="text-fg-strong">in</span>
      <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">flow</span>
    </span>
  );
}

/** The ƒ app-icon monogram: a gradient rounded square with a white italic ƒ. */
export function LogoMark({ size = 24 }: { size?: number }) {
  const gid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className="shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gid})`} />
      <text x="20.5" y="28.5" fontSize="26" fontWeight="800" fontStyle="italic" fill="#fff" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif">
        ƒ
      </text>
    </svg>
  );
}

/** Full lockup: the ƒ monogram + the gradient wordmark. Collapsed = mark only. */
export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) return <LogoMark size={26} />;
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={22} />
      <Wordmark className="text-[19px]" />
    </span>
  );
}
