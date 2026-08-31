/**
 * The list's "still working" row: a small spinner and a label.
 *
 * The conversation list defined this inline and the network view had its own
 * bare line of text, so the two looked nothing alike while doing the same job.
 * Shared here so they cannot drift again — same size, colour and spacing
 * everywhere, with only the label changing.
 */
export function ListLoadingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-xs text-fg-faint">
      <svg
        className="h-3 w-3 animate-spin"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
      </svg>
      {label}
    </div>
  );
}
