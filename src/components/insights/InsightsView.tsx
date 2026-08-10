import { useMemo, useState } from 'react';
import { useConnections } from '@/hooks/useConnections';
import { useUIStore } from '@/store/ui-store';
import { computeInsights, type CountItem } from '@/lib/connection-insights';
import { normalizeOrder } from '@/lib/reorder';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { ChartSection } from './ChartSection';
import { CHART_PALETTE, roleColor } from './chart-colors';
import { FollowUpsSection, AISuggestionsSection } from './SuggestionsTab';

function pctLabel(pct: number): string {
  return `${Math.round(pct * 100)}%`;
}

// "Ask your network" lives in its own Chat section; AI suggestions is its own card.
const ALL_SECTIONS = ['aisuggestions', 'composition', 'firms', 'interests', 'followups'] as const;
type SectionKey = (typeof ALL_SECTIONS)[number];
// Bumped to v3: split suggestions into aisuggestions/followups; AI suggestions first.
const ORDER_KEY = 'inflow-insights-order-v3';
const HIDDEN_KEY = 'inflow-insights-hidden-v1';
// AI-driven cards get the sparkle mark.
const AI_SECTIONS: ReadonlySet<SectionKey> = new Set(['aisuggestions']);

function loadOrder(): SectionKey[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeOrder(parsed, [...ALL_SECTIONS]) as SectionKey[];
    }
  } catch {}
  return [...ALL_SECTIONS];
}
function saveOrder(order: SectionKey[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {}
}

function loadHidden(): SectionKey[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((k): k is SectionKey => (ALL_SECTIONS as readonly string[]).includes(k));
    }
  } catch {}
  return [];
}
function saveHidden(hidden: SectionKey[]) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
  } catch {}
}

export function InsightsView() {
  const { connections, isLoading } = useConnections();
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const showConnections = useUIStore((s) => s.showConnections);
  const insights = useMemo(() => computeInsights(connections), [connections]);

  const [order, setOrder] = useState<SectionKey[]>(loadOrder);
  const [hidden, setHidden] = useState<SectionKey[]>(loadHidden);
  const [customizing, setCustomizing] = useState(false);

  const { total, uncategorized, roles, interests, companies } = insights;
  const topRole = roles[0];
  const empty = !isLoading && connections.length === 0;

  // Section definitions: content + whether it has anything to show + width span.
  const defs: Record<SectionKey, { title: string; span: 1 | 2; padded: boolean; available: boolean; node: React.ReactNode }> = {
    aisuggestions: { title: 'AI suggestions', span: 2, padded: true, available: true, node: <AISuggestionsSection /> },
    composition: {
      title: 'Composition by role', span: 1, padded: true, available: roles.length > 0,
      node: (
        <ChartSection
          data={roles.map((r) => ({
            key: r.role,
            label: r.role,
            value: r.count,
            color: roleColor(r.role),
            ariaLabel: `Show ${r.role}`,
            onClick: () => showConnections({ filter: { kind: 'role', value: r.role as any } }),
          }))}
        />
      ),
    },
    firms: {
      title: 'Firms your network clusters around', span: 1, padded: true, available: companies.length > 0,
      node: (
        <ChartSection
          data={companies.slice(0, 10).map((c, i) => ({
            key: c.name,
            label: c.name,
            value: c.count,
            color: CHART_PALETTE[i % CHART_PALETTE.length],
            ariaLabel: `Show ${c.name}`,
            onClick: () => showConnections({ search: c.name }),
          }))}
        />
      ),
    },
    interests: {
      title: 'Interest tags', span: 1, padded: true, available: interests.length > 0,
      node: (
        <ChartSection
          data={interests.map((t: CountItem, i) => ({
            key: t.name,
            label: `★ ${t.name}`,
            value: t.count,
            color: CHART_PALETTE[i % CHART_PALETTE.length],
            ariaLabel: `Show ★ ${t.name}`,
            onClick: () => showConnections({ filter: { kind: 'interest', value: t.name } }),
          }))}
        />
      ),
    },
    followups: { title: 'Follow up', span: 2, padded: true, available: true, node: <FollowUpsSection /> },
  };

  const hiddenSet = new Set(hidden);
  const visibleKeys = order.filter((k) => defs[k].available && !hiddenSet.has(k));
  const hiddenAvailable = order.filter((k) => defs[k].available && hiddenSet.has(k));

  // Move a card up/down among its visible siblings (swaps in the full order).
  const move = (key: SectionKey, dir: -1 | 1) => {
    const vi = visibleKeys.indexOf(key);
    const target = visibleKeys[vi + dir];
    if (!target) return;
    const next = [...order];
    const a = next.indexOf(key);
    const b = next.indexOf(target);
    [next[a], next[b]] = [next[b], next[a]];
    setOrder(next);
    saveOrder(next);
  };
  const setHiddenPersist = (next: SectionKey[]) => {
    setHidden(next);
    saveHidden(next);
  };
  const hide = (key: SectionKey) => setHiddenPersist(hiddenSet.has(key) ? hidden : [...hidden, key]);
  const show = (key: SectionKey) => setHiddenPersist(hidden.filter((k) => k !== key));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
        <h2 className="text-base font-semibold text-fg-strong">Insights</h2>
        {total > 0 && (
          <span className="rounded-full bg-surface-input px-2 py-0.5 text-[11px] font-medium text-fg-muted">
            {total} connection{total === 1 ? '' : 's'}
          </span>
        )}
        {!empty && (
          <button
            onClick={() => setCustomizing((v) => !v)}
            aria-pressed={customizing}
            className={`ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
              customizing
                ? 'bg-blue-500/15 text-blue-300 ring-blue-500/30'
                : 'text-fg-muted ring-edge hover:text-fg-secondary'
            }`}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            </svg>
            {customizing ? 'Done' : 'Customize'}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {empty ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <p className="text-sm text-fg-muted">No connections yet — open Connections to sync them.</p>
            <button onClick={() => setActiveSection('connections')} className="rounded-lg btn-primary px-4 py-2 text-sm font-medium">
              Go to Connections
            </button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[1600px] space-y-5">
            {/* Hero (full width) */}
            {topRole && (
              <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-transparent p-5 ring-1 ring-inset ring-blue-500/20">
                <p className="text-2xl font-semibold text-fg-strong">
                  Your network is {pctLabel(topRole.pct)} {topRole.role.toLowerCase()}s
                </p>
                {companies.length > 0 && (
                  <p className="mt-1 text-sm text-fg-secondary">
                    Clustered around {companies.slice(0, 3).map((c) => c.name).join(', ')}
                    {companies.length > 3 ? ' and more' : ''}.
                  </p>
                )}
              </div>
            )}

            {uncategorized > 0 && (
              <button onClick={() => setActiveSection('connections')} className="w-full rounded-lg bg-amber-500/10 px-4 py-2 text-left text-[13px] text-amber-300 ring-1 ring-inset ring-amber-500/20 transition-colors hover:bg-amber-500/15">
                {uncategorized} of {total} not categorized yet — categorize them in Connections for complete insights.
              </button>
            )}

            {/* Responsive section grid — reorder/hide via the Customize controls */}
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              {visibleKeys.map((key, idx) => {
                const def = defs[key];
                const isAI = AI_SECTIONS.has(key);
                return (
                  <div
                    key={key}
                    data-section={key}
                    className={`overflow-hidden rounded-xl bg-surface-raised ring-1 ring-inset ring-edge ${def.span === 2 ? 'xl:col-span-2' : ''}`}
                  >
                    <div className="flex items-center gap-2 border-b border-edge px-5 py-3">
                      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg-strong">
                        {isAI && <SparkleIcon className="h-3.5 w-3.5 text-blue-400" />}
                        {def.title}
                      </h3>
                      {customizing && (
                        <div className="ml-auto flex items-center gap-0.5">
                          <button
                            onClick={() => move(key, -1)}
                            disabled={idx === 0}
                            title="Move up"
                            aria-label={`Move ${def.title} up`}
                            className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:opacity-30"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
                          </button>
                          <button
                            onClick={() => move(key, 1)}
                            disabled={idx === visibleKeys.length - 1}
                            title="Move down"
                            aria-label={`Move ${def.title} down`}
                            className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:opacity-30"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                          </button>
                          <button
                            onClick={() => hide(key)}
                            title="Hide section"
                            aria-label={`Hide ${def.title}`}
                            className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-red-400"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" /></svg>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className={def.padded ? 'p-5' : ''}>{def.node}</div>
                  </div>
                );
              })}
            </div>

            {/* Hidden-section tray (customize mode) */}
            {customizing && hiddenAvailable.length > 0 && (
              <div className="rounded-xl border border-dashed border-edge p-4">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Hidden sections</p>
                <div className="flex flex-wrap gap-2">
                  {hiddenAvailable.map((key) => (
                    <button
                      key={key}
                      onClick={() => show(key)}
                      className="flex items-center gap-1.5 rounded-lg bg-surface-input px-2.5 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                      {defs[key].title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
