import { useEffect, useState } from 'react';

export type ChartType = 'bar' | 'column' | 'pie';

/** Darken a #rrggbb hex for the extruded 3D side face. */
function darkenHex(hex: string, f = 0.42): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - f));
  const g = Math.round(((n >> 8) & 255) * (1 - f));
  const b = Math.round((n & 255) * (1 - f));
  return `rgb(${r}, ${g}, ${b})`;
}

export interface ChartDatum {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Accessible label + tooltip for the clickable element. */
  ariaLabel?: string;
  onClick?: () => void;
}

/**
 * A tiny, dependency-free chart that animates in and renders as bars, columns,
 * or a donut. Each element is clickable (drill-in). Switching type re-runs the
 * grow animation.
 */
export function MiniChart({ data, type }: { data: ChartDatum[]; type: ChartType }) {
  const [grown, setGrown] = useState(false);

  // Reset then flip on the next frame so the CSS transition plays — on mount and
  // whenever the type changes.
  useEffect(() => {
    setGrown(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(id);
  }, [type]);

  const max = Math.max(1, ...data.map((d) => d.value));

  if (type === 'bar') {
    return (
      <div className="space-y-1">
        {data.map((d) => {
          const w = grown ? Math.max(4, Math.round((d.value / max) * 100)) : 0;
          const row = (
            <>
              <div className="w-28 shrink-0 truncate text-sm text-fg-secondary" title={d.label}>{d.label}</div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-input">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${w}%`, backgroundColor: d.color }}
                />
              </div>
              <div className="w-8 shrink-0 text-right text-xs tabular-nums text-fg-muted">{d.value}</div>
            </>
          );
          return d.onClick ? (
            <button
              key={d.key}
              type="button"
              onClick={d.onClick}
              aria-label={d.ariaLabel}              className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-hover"
            >
              {row}
            </button>
          ) : (
            <div key={d.key} className="flex items-center gap-3">{row}</div>
          );
        })}
      </div>
    );
  }

  if (type === 'column') {
    const top = data.slice(0, 10);
    return (
      <div>
        <div className="flex items-end gap-1.5" style={{ height: 160 }}>
          {top.map((d) => {
            const px = grown ? Math.max(6, Math.round((d.value / max) * 150)) : 0;
            const bar = (
              <div
                className="w-full rounded-t transition-[height] duration-700 ease-out"
                style={{ height: px, backgroundColor: d.color }}
              />
            );
            return (
              <div key={d.key} className="flex min-w-0 flex-1 items-end" style={{ height: '100%' }}>
                {d.onClick ? (
                  <button onClick={d.onClick} aria-label={d.ariaLabel} className="w-full transition-opacity hover:opacity-80">
                    {bar}
                  </button>
                ) : (
                  bar
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {top.map((d) => (
            <span key={d.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-fg-muted" title={d.label}>
              {d.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // 3D pie — a tilted ellipse (top face) with an extruded, darker side.
  const top = data.slice(0, 8);
  const total = Math.max(1, top.reduce((s, d) => s + d.value, 0));
  const cx = 120, cy = 78, rx = 112, ry = 62, depth = 26;
  const ep = (angle: number): [number, number] => {
    const a = ((angle - 90) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  };
  const topWedge = (start: number, end: number): string => {
    const [x1, y1] = ep(start);
    const [x2, y2] = ep(end);
    const large = end - start > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rx} ${ry} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  };
  // The visible side is only the front (lower) half of the ellipse: angles 90–270.
  const sidePath = (start: number, end: number): string | null => {
    const cs = Math.max(start, 90);
    const ce = Math.min(end, 270);
    if (ce <= cs) return null;
    const [x1, y1] = ep(cs);
    const [x2, y2] = ep(ce);
    const large = ce - cs > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rx} ${ry} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x2.toFixed(2)} ${(y2 + depth).toFixed(2)} A ${rx} ${ry} 0 ${large} 0 ${x1.toFixed(2)} ${(y1 + depth).toFixed(2)} Z`;
  };
  let acc = 0;
  const slices = top.map((d) => {
    const start = acc * 360;
    acc += d.value / total;
    return { ...d, start, end: acc * 360 };
  });
  const single = slices.length === 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-6">
      <svg
        viewBox="0 0 240 170"
        data-chart="pie"
        role="img"
        aria-label="3D pie chart"
        className="w-72 max-w-full shrink-0"
        style={{
          transform: grown ? 'scale(1)' : 'scale(0.6)',
          opacity: grown ? 1 : 0,
          transformOrigin: 'center',
          transition: 'transform 500ms cubic-bezier(0.34, 1.3, 0.64, 1), opacity 350ms ease-out',
        }}
      >
        {/* Extruded side faces (front half), drawn first so top faces overlay them. */}
        {(single ? [slices[0] && { ...slices[0], start: 90, end: 270 }] : slices).filter(Boolean).map((s: any) => {
          const d = sidePath(s.start, s.end);
          return d ? <path key={`side-${s.key}`} d={d} fill={darkenHex(s.color)} /> : null;
        })}
        {/* Top faces */}
        {single ? (
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={slices[0].color} style={{ cursor: slices[0].onClick ? 'pointer' : 'default' }} onClick={slices[0].onClick} />
        ) : (
          slices.map((s) => (
            <path
              key={s.key}
              d={topWedge(s.start, s.end)}
              fill={s.color}
              style={{ cursor: s.onClick ? 'pointer' : 'default' }}
              onClick={s.onClick}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </path>
          ))
        )}
      </svg>
      <div className="space-y-1.5">
        {top.map((d) => (
          <button
            key={d.key}
            onClick={d.onClick}
            disabled={!d.onClick}
            aria-label={d.ariaLabel}
            className="flex items-center gap-3 rounded px-1.5 py-1 text-left text-sm transition-colors hover:bg-surface-hover disabled:hover:bg-transparent"
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
            <span className="w-32 truncate text-fg-secondary" title={d.label}>{d.label}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">{d.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
