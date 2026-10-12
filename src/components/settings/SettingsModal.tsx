import { useCallback, useEffect, useState } from 'react';
import { useUIStore, type SettingsSection, type Theme } from '@/store/ui-store';
import {
  DEFAULT_INBOX_LABELS,
  DEFAULT_INBOX_SECTION_LABEL,
  normalizeInboxLabels,
  normalizeSectionLabel,
} from '@/lib/inbox-labels';
import {
  getAIChatMaxWords,
  setAIChatMaxWords,
  getAIChatInstructions,
  setAIChatInstructions,
  getAIChatAppendInstructions,
  setAIChatAppendInstructions,
  DEFAULT_CHAT_MAX_WORDS,
  CHAT_MAX_WORDS_MIN,
  CHAT_MAX_WORDS_MAX,
  CHAT_INSTRUCTIONS_MAX_CHARS,
  CHAT_APPEND_MAX_CHARS,
  getChatPrompts,
  setChatPrompts,
  DEFAULT_CHAT_PROMPTS,
  CHAT_PROMPTS_MAX,
  CHAT_PROMPT_MAX_CHARS,
} from '@/lib/ai-settings';
import { DEFAULT_CHAT_INSTRUCTIONS } from '@/lib/connection-chat';
import { isDemoMode, enableDemoMode, disableDemoMode } from '@/lib/demo-mode';
import { checkForUpdateAndToast } from '@/lib/check-update';
import { AIKeySettings } from './AIKeySettings';
import { BackupSettings } from './BackupSettings';
import { Toggle } from '@/components/common/Toggle';
import { Logo } from '@/components/common/Wordmark';

/**
 * Safeguards on the drafts Claude creates. It lives under AI because that is
 * exactly its scope: a draft Claude made resolved a name to a URN out of the
 * user's sight, and a name search can return several different people with the
 * same name. A draft written in the composer needs no such check, since the
 * user picked the recipient from a list showing their name, headline and photo.
 */
function SendingSettings() {
  const confirmRecipient = useUIStore((s) => s.confirmRecipient);
  const setConfirmRecipient = useUIStore((s) => s.setConfirmRecipient);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-fg-strong">Drafts from Claude</h3>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-strong">Confirm the person before sending Claude's InMail drafts</p>
          <p className="text-xs text-fg-muted">
            When Claude drafts an InMail it looks the person up by name, and names repeat.
            With this on, the Outbox shows their LinkedIn profile link and Send stays
            disabled until you open it and confirm it is the right person. InMail you write
            yourself is never gated, because you already picked the recipient, and neither
            are messages to your connections.
          </p>
        </div>
        <Toggle
          label="Confirm the person before sending Claude's InMail drafts"
          checked={confirmRecipient}
          onChange={setConfirmRecipient}
        />
      </div>
    </div>
  );
}

interface SectionDef {
  id: SettingsSection;
  label: string;
  /** Nested sub-sections shown as an indented branch when expanded. */
  children?: SectionDef[];
}

const SECTIONS: SectionDef[] = [
  { id: 'ai', label: 'AI', children: [{ id: 'chat', label: 'Chat' }, { id: 'sending', label: 'Drafts' }] },
  { id: 'appearance', label: 'Appearance' },
  { id: 'backup', label: 'Backup' },
  { id: 'advanced', label: 'Demo mode' },
  { id: 'about', label: 'About' },
];

/**
 * All AI Chat behavior in one section, committed together on a single Save:
 * answer length, the user's own instructions (layered on top of the default),
 * the editable default prompt (advanced disclosure), and the starter questions.
 */
function ChatSettings() {
  const showToast = useUIStore((s) => s.showToast);

  const [maxWords, setMaxWords] = useState<number | ''>(DEFAULT_CHAT_MAX_WORDS);
  const [append, setAppend] = useState('');
  const [base, setBase] = useState(DEFAULT_CHAT_INSTRUCTIONS);
  const [prompts, setPrompts] = useState<string[]>(['']);
  const [saved, setSaved] = useState<{ maxWords: number; append: string; base: string; prompts: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getAIChatMaxWords(),
      getAIChatAppendInstructions(),
      getAIChatInstructions(),
      getChatPrompts(),
    ]).then(([w, ap, base0, p]) => {
      if (cancelled) return;
      const baseText = base0.trim() || DEFAULT_CHAT_INSTRUCTIONS;
      setMaxWords(w);
      setAppend(ap);
      setBase(baseText);
      setPrompts(p.length ? p : ['']);
      setSaved({ maxWords: w, append: ap, base: baseText, prompts: p });
    });
    return () => { cancelled = true; };
  }, []);

  const wordsVal = typeof maxWords === 'number' && Number.isFinite(maxWords) ? maxWords : DEFAULT_CHAT_MAX_WORDS;
  const cleanedPrompts = prompts.map((s) => s.trim()).filter(Boolean);
  const dirty = saved
    ? wordsVal !== saved.maxWords ||
      append !== saved.append ||
      base !== saved.base ||
      JSON.stringify(cleanedPrompts) !== JSON.stringify(saved.prompts)
    : false;

  const save = async () => {
    setBusy(true);
    // Only persist a base override when it differs from the built-in default, so
    // app updates keep flowing through when the user hasn't touched it.
    const baseToStore = base.trim() === DEFAULT_CHAT_INSTRUCTIONS ? '' : base;
    await Promise.all([
      setAIChatMaxWords(wordsVal),
      setAIChatAppendInstructions(append),
      setAIChatInstructions(baseToStore),
      setChatPrompts(prompts),
    ]);
    const [w, storedPrompts] = await Promise.all([getAIChatMaxWords(), getChatPrompts()]);
    setMaxWords(w);
    setPrompts(storedPrompts.length ? storedPrompts : ['']);
    setSaved({ maxWords: w, append, base: base.trim() || DEFAULT_CHAT_INSTRUCTIONS, prompts: storedPrompts });
    setBusy(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    showToast({ message: 'Chat settings saved' });
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* Answer length */}
      <div>
        <h3 className="text-sm font-semibold text-fg-strong">Answer style</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          How AI Chat answers — applies to whichever provider (Gemini or Claude) is active. Answers are never cut off; this only steers the model.
        </p>
        <div className="mt-3">
          <label htmlFor="ai-max-words" className="text-sm font-medium text-fg-strong">Target answer length</label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="ai-max-words"
              type="number"
              min={CHAT_MAX_WORDS_MIN}
              max={CHAT_MAX_WORDS_MAX}
              step={50}
              value={maxWords}
              onChange={(e) => setMaxWords(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-32 rounded-lg bg-surface-input px-2.5 py-1.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
            />
            <span className="text-xs text-fg-muted">words</span>
          </div>
          <p className="mt-1 text-[11px] text-fg-faint">0 = no target (let the model decide). A number nudges the model — a hint, not a hard cutoff.</p>
        </div>
      </div>

      {/* Additional (on top) instructions — the user's safe layer */}
      <div className="mt-8 border-t border-edge pt-6">
        <h3 className="text-sm font-semibold text-fg-strong">Your instructions</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Layered on top of the default prompt — this is your own, and app updates never touch it.
        </p>
        <textarea
          value={append}
          maxLength={CHAT_APPEND_MAX_CHARS}
          onChange={(e) => setAppend(e.target.value)}
          rows={4}
          placeholder="e.g. Keep a warm tone, prefer short bullets, and always suggest a next step."
          className="mt-2 w-full resize-y rounded-lg bg-surface-input px-3 py-2 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
        />
        <p className="mt-1 text-[11px] text-fg-faint">{append.length}/{CHAT_APPEND_MAX_CHARS}</p>
      </div>

      {/* Default prompt — advanced disclosure */}
      <div className="mt-8 border-t border-edge pt-6">
        <button
          type="button"
          onClick={() => setPromptOpen((v) => !v)}
          aria-expanded={promptOpen}
          className="flex items-center gap-2 text-sm font-semibold text-fg-strong"
        >
          <svg className={`h-3.5 w-3.5 text-fg-faint transition-transform ${promptOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          Default prompt
          <span className="font-normal text-fg-faint">(advanced)</span>
        </button>
        {promptOpen && (
          <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300">
              Heads up: this is the built-in base prompt. If you edit it, future app updates won’t change your copy. For most tweaks use “Your instructions” above — edit here only for full control. You can reset anytime.
            </div>
            <div className="flex justify-end">
              {base.trim() !== DEFAULT_CHAT_INSTRUCTIONS && (
                <button type="button" onClick={() => setBase(DEFAULT_CHAT_INSTRUCTIONS)} className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg-secondary">
                  Reset to defaults
                </button>
              )}
            </div>
            <textarea
              value={base}
              maxLength={CHAT_INSTRUCTIONS_MAX_CHARS}
              onChange={(e) => setBase(e.target.value)}
              rows={10}
              className="w-full resize-y rounded-lg bg-surface-input px-3 py-2 font-mono text-[13px] leading-relaxed text-fg-strong ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
            />
            <p className="text-[11px] text-fg-faint">The connection list is added automatically after this. {base.length}/{CHAT_INSTRUCTIONS_MAX_CHARS}</p>
          </div>
        )}
      </div>

      {/* Starter questions */}
      <div className="mt-8 border-t border-edge pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-fg-strong">Starter questions</h3>
          {JSON.stringify(cleanedPrompts) !== JSON.stringify(DEFAULT_CHAT_PROMPTS) && (
            <button type="button" onClick={() => setPrompts([...DEFAULT_CHAT_PROMPTS])} className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg-secondary">
              Reset to defaults
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">The suggestions shown in a new chat. Edit, add, or remove them.</p>
        <div className="mt-3 space-y-2">
          {prompts.map((q, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={q}
                maxLength={CHAT_PROMPT_MAX_CHARS}
                onChange={(e) => setPrompts((cur) => cur.map((c, j) => (j === i ? e.target.value : c)))}
                placeholder="e.g. Who should I reconnect with this month?"
                className="min-w-0 flex-1 rounded-lg bg-surface-input px-2.5 py-1.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
              />
              <button type="button" onClick={() => setPrompts((cur) => (cur.length > 1 ? cur.filter((_, j) => j !== i) : ['']))} aria-label="Remove question" title="Remove" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setPrompts((cur) => (cur.length >= CHAT_PROMPTS_MAX ? cur : [...cur, '']))} disabled={prompts.length >= CHAT_PROMPTS_MAX} className="mt-2 rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-40">
          Add question
        </button>
      </div>

      {/* One Save for the whole section, pinned bottom-right */}
      <div className="mt-8 flex flex-1 items-end justify-end">
        <button onClick={save} disabled={!dirty || busy} className="rounded-md bg-blue-500/15 px-4 py-1.5 text-sm font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-300">
          {justSaved ? 'Saved ✓' : busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const inboxLabels = useUIStore((s) => s.inboxLabels);
  const setInboxLabels = useUIStore((s) => s.setInboxLabels);
  const inboxSectionLabel = useUIStore((s) => s.inboxSectionLabel);
  const setInboxSectionLabel = useUIStore((s) => s.setInboxSectionLabel);

  // Everything in this section is a draft until the one Save at the bottom, so
  // nothing changes by accident and the whole section commits together.
  const [themeDraft, setThemeDraft] = useState<Theme>(theme);
  const [sectionDraft, setSectionDraft] = useState(inboxSectionLabel);
  const [labels, setLabels] = useState(inboxLabels);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => setThemeDraft(theme), [theme]);
  useEffect(() => setSectionDraft(inboxSectionLabel), [inboxSectionLabel]);
  useEffect(() => setLabels(inboxLabels), [inboxLabels]);

  const nextSection = normalizeSectionLabel(sectionDraft);
  const nextLabels = normalizeInboxLabels(labels);
  const dirty =
    themeDraft !== theme ||
    nextSection !== inboxSectionLabel ||
    nextLabels.focused !== inboxLabels.focused ||
    nextLabels.other !== inboxLabels.other;

  const save = () => {
    setTheme(themeDraft);
    setInboxSectionLabel(sectionDraft);
    setInboxLabels(labels);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const namesAtDefault =
    nextSection === DEFAULT_INBOX_SECTION_LABEL &&
    nextLabels.focused === DEFAULT_INBOX_LABELS.focused &&
    nextLabels.other === DEFAULT_INBOX_LABELS.other;
  const resetNames = () => {
    setSectionDraft(DEFAULT_INBOX_SECTION_LABEL);
    setLabels({ ...DEFAULT_INBOX_LABELS });
  };

  const themeOptions: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
    { value: 'purple', label: 'Purple' },
  ];
  const nameFields: { key: 'focused' | 'other'; heading: string; hint: string }[] = [
    { key: 'focused', heading: 'Primary tab', hint: 'LinkedIn’s primary inbox — your main conversations.' },
    { key: 'other', heading: 'Secondary tab', hint: 'InMail, connection requests, and lower-priority threads.' },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <div>
        <h3 className="text-sm font-semibold text-fg-strong">Theme</h3>
        <p className="mt-1 text-sm text-fg-secondary">Choose how inflow looks.</p>
        <div className="mt-3 inline-flex rounded-lg bg-surface p-1 ring-1 ring-ring">
          {themeOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => setThemeDraft(o.value)}
              aria-pressed={themeDraft === o.value}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                themeDraft === o.value
                  ? 'bg-blue-500/15 text-blue-700 ring-1 ring-inset ring-blue-500/30 dark:text-blue-200'
                  : 'text-fg-secondary hover:text-fg-strong'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 border-t border-edge pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-fg-strong">Inbox names</h3>
          {!namesAtDefault && (
            <button
              onClick={resetNames}
              className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg-secondary"
            >
              Reset to defaults
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Rename the Inbox section and its two LinkedIn tabs to whatever fits how you work.
        </p>
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg-strong">Section name</p>
              <p className="text-xs text-fg-muted">The nav label — e.g. “Messages” instead of “Inbox”.</p>
            </div>
            <input
              value={sectionDraft}
              maxLength={24}
              onChange={(e) => setSectionDraft(e.target.value)}
              placeholder={DEFAULT_INBOX_SECTION_LABEL}
              className="w-40 shrink-0 rounded-lg bg-surface-input px-2.5 py-1.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
            />
          </div>
          {nameFields.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg-strong">{f.heading}</p>
                <p className="text-xs text-fg-muted">{f.hint}</p>
              </div>
              <input
                value={labels[f.key]}
                maxLength={24}
                onChange={(e) => setLabels((d) => ({ ...d, [f.key]: e.target.value }))}
                placeholder={DEFAULT_INBOX_LABELS[f.key]}
                className="w-40 shrink-0 rounded-lg bg-surface-input px-2.5 py-1.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
              />
            </div>
          ))}
        </div>
      </div>

      {/* One Save for the whole section, pinned to the bottom-right. */}
      <div className="mt-8 flex flex-1 items-end justify-end">
        <button
          onClick={save}
          disabled={!dirty}
          className="rounded-md bg-blue-500/15 px-4 py-1.5 text-sm font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-300"
        >
          {justSaved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function AdvancedSettings() {
  // demoMode from the store keeps this in sync if toggled elsewhere.
  const demoMode = useUIStore((s) => s.demoMode);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-strong">Demo mode</p>
          <p className="text-xs text-fg-muted">
            Browse a synthetic inbox with fake data — nothing touches your real LinkedIn account.
          </p>
        </div>
        <button
          onClick={() => (isDemoMode() ? disableDemoMode() : enableDemoMode())}
          className="shrink-0 rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          {demoMode ? 'Exit demo mode' : 'Enter demo mode'}
        </button>
      </div>
    </div>
  );
}

function AboutSettings() {
  const showToast = useUIStore((s) => s.showToast);
  const [checking, setChecking] = useState(false);
  const version = (() => {
    try {
      return chrome?.runtime?.getManifest?.().version ?? '';
    } catch {
      return '';
    }
  })();

  const check = async () => {
    setChecking(true);
    try {
      await checkForUpdateAndToast(showToast);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Logo />
        {version && <p className="mt-1 text-sm text-fg-secondary">Version {version}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={check}
          disabled={checking}
          className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        <button
          onClick={() => {
            useUIStore.getState().closeSettings();
            useUIStore.getState().setWhatsNewOpen(true);
          }}
          className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          What&rsquo;s new
        </button>
      </div>
      <div className="flex flex-col gap-2 border-t border-edge pt-4 text-sm">
        <a
          href="https://github.com/grinich/inflow/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-blue-500 hover:text-blue-400"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="8" y="6" width="8" height="14" rx="4" />
            <path d="M19 7l-3 2M5 7l3 2M12 20v-8M20 13h-4M8 13H4M19 18l-3-2M5 18l3-2M9 3l1 3h4l1-3" />
          </svg>
          Report a bug
        </a>
        <a
          href="https://chat.whatsapp.com/Cgj71APZz0uBkW5Y4WOhQO"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-blue-500 hover:text-blue-400"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
          </svg>
          Join the WhatsApp group
        </a>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const section = useUIStore((s) => s.settingsSection);
  const close = useUIStore((s) => s.closeSettings);
  const setSection = useCallback(
    (s: SettingsSection) => useUIStore.getState().openSettings(s),
    [],
  );

  // Expandable AI branch in the settings nav (mirrors the app's nav tree).
  const [aiBranchOpen, setAiBranchOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('inflow-settings-ai-branch') !== '0'; } catch { return true; }
  });
  const toggleAiBranch = () => setAiBranchOpen((v) => {
    const next = !v;
    try { localStorage.setItem('inflow-settings-ai-branch', next ? '1' : '0'); } catch {}
    return next;
  });
  const sectionBtnClass = (active: boolean) =>
    `rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors ${
      active
        ? 'bg-blue-500/15 text-fg-strong ring-1 ring-inset ring-blue-500/30'
        : 'text-fg-muted hover:bg-surface-hover hover:text-fg-secondary'
    }`;

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[85vh] max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl bg-surface-raised shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Section nav */}
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-edge bg-surface p-2">
          <p className="px-2 pb-1 pt-1 text-sm font-semibold text-fg-strong">Settings</p>
          {SECTIONS.map((s) => {
            if (!s.children?.length) {
              return (
                <button key={s.id} onClick={() => setSection(s.id)} aria-current={section === s.id ? 'page' : undefined} className={sectionBtnClass(section === s.id)}>
                  {s.label}
                </button>
              );
            }
            // A parent with a branch: the row navigates; the chevron toggles it.
            return (
              <div key={s.id}>
                <div className="flex items-center">
                  <button onClick={() => setSection(s.id)} aria-current={section === s.id ? 'page' : undefined} className={`flex-1 ${sectionBtnClass(section === s.id)}`}>
                    {s.label}
                  </button>
                  <button
                    onClick={toggleAiBranch}
                    aria-label={aiBranchOpen ? `Collapse ${s.label}` : `Expand ${s.label}`}
                    aria-expanded={aiBranchOpen}
                    className="ml-0.5 shrink-0 rounded-md p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-secondary"
                  >
                    <svg className={`h-3.5 w-3.5 transition-transform ${aiBranchOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </div>
                {aiBranchOpen && (
                  <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-edge pl-2">
                    {s.children.map((c) => (
                      <button key={c.id} onClick={() => setSection(c.id)} aria-current={section === c.id ? 'page' : undefined} className={sectionBtnClass(section === c.id)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Section content — a fixed top bar holds the close button so it never
            overlaps a section's content (a full-width banner used to collide). */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 justify-end px-3 pt-3">
            <button
              onClick={close}
              aria-label="Close settings"
              className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-1">
            {section === 'ai' && <AIKeySettings />}
            {section === 'chat' && <ChatSettings />}
            {section === 'sending' && <SendingSettings />}
            {section === 'appearance' && <AppearanceSettings />}
            {section === 'backup' && <BackupSettings />}
            {section === 'advanced' && <AdvancedSettings />}
            {section === 'about' && <AboutSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}
