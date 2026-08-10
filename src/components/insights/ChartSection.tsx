import { useState } from 'react';
import { MiniChart, type ChartType, type ChartDatum } from './MiniChart';

const TYPES: { type: ChartType; label: string; icon: React.ReactNode }[] = [
  {
    type: 'bar',
    label: 'Bar chart',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="4" y1="7" x2="16" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="11" y2="17" />
      </svg>
    ),
  },
  {
    type: 'column',
    label: 'Column chart',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="6" y1="20" x2="6" y2="12" /><line x1="12" y1="20" x2="12" y2="5" /><line x1="18" y1="20" x2="18" y2="9" />
      </svg>
    ),
  },
  {
    type: 'pie',
    label: 'Pie chart',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10H12z" /><path d="M12 2v10h10A10 10 0 0 0 12 2z" />
      </svg>
    ),
  },
];

/** A chart with a small icon-only switcher (bar / column / pie). */
export function ChartSection({ data }: { data: ChartDatum[] }) {
  const [type, setType] = useState<ChartType>('bar');
  return (
    <div>
      <div className="mb-2 flex justify-end gap-0.5">
        {TYPES.map((t) => (
          <button
            key={t.type}
            onClick={() => setType(t.type)}
            aria-label={t.label}
            aria-pressed={type === t.type}
            title={t.label}
            className={`rounded p-1 transition-colors ${
              type === t.type ? 'bg-blue-500/15 text-blue-300' : 'text-fg-faint hover:bg-surface-hover hover:text-fg-secondary'
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <MiniChart data={data} type={type} />
    </div>
  );
}
