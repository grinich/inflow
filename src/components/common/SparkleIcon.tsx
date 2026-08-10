/**
 * The shared "AI" mark — a sparkle/stars glyph used to denote AI-driven actions
 * (categorize, summarize, ask, suggestions, draft) consistently across the app.
 */
export function SparkleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" />
      <path d="M5 16l.7 2L8 18.7 6 19.4 5 21l-.7-2L2 18.3 4 17.6 5 16z" />
    </svg>
  );
}
