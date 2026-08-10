import { useState, useEffect } from 'react';
import { useUIStore } from '@/store/ui-store';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  clearGeminiApiKey,
  getAnthropicApiKey,
  setAnthropicApiKey,
  clearAnthropicApiKey,
  getAIProvider,
  setAIProvider,
  getAnthropicModel,
  setAnthropicModel,
  getAISuggestionsEnabled,
  setAISuggestionsEnabled,
  ANTHROPIC_MODELS,
  type AIProvider,
  type AIModelTier,
} from '@/lib/ai-settings';
import { ANTHROPIC_URL, anthropicErrorMessage } from '@/lib/anthropic-client';
import { useCategorizeMode } from '@/hooks/useCategorizeMode';
import { Toggle } from '@/components/common/Toggle';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

/** Small on/off switch row. */
function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg-strong">{label}</p>
        <p className="text-xs text-fg-muted">{description}</p>
      </div>
      <Toggle label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/** A dropdown that picks a Claude model for one tier. */
function ModelSelect({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-fg-strong">{label}</span>
      <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-md bg-surface px-3 py-2 text-sm text-fg ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {ANTHROPIC_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.blurb}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The AI settings section: pick a provider (Claude or Gemini), manage that
 * provider's API key (with get-a-key instructions), and — for Claude — choose a
 * cheap model for bulk work and a stronger one for writing. Also holds the
 * categorize mode and reply-suggestions toggles. Rendered inside the Settings
 * modal; contains no modal chrome of its own.
 */
export function AIKeySettings() {
  const showToast = useUIStore((s) => s.showToast);

  const [provider, setProvider] = useState<AIProvider>('gemini');

  // Gemini key state
  const [geminiInput, setGeminiInput] = useState('');
  const [geminiSaved, setGeminiSaved] = useState<string | null>(null);
  const [geminiShow, setGeminiShow] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<TestStatus>('idle');
  const [geminiError, setGeminiError] = useState('');

  // Anthropic key state
  const [anthInput, setAnthInput] = useState('');
  const [anthSaved, setAnthSaved] = useState<string | null>(null);
  const [anthShow, setAnthShow] = useState(false);
  const [anthStatus, setAnthStatus] = useState<TestStatus>('idle');
  const [anthError, setAnthError] = useState('');
  const [fastModel, setFastModel] = useState('claude-haiku-4-5');
  const [qualityModel, setQualityModel] = useState('claude-sonnet-5');

  const [suggestionsOn, setSuggestionsOn] = useState(true);
  const [categorizeMode, setCategorizeMode] = useCategorizeMode();

  useEffect(() => {
    getAIProvider().then(setProvider);
    getGeminiApiKey().then(setGeminiSaved);
    getAnthropicApiKey().then(setAnthSaved);
    getAnthropicModel('fast').then(setFastModel);
    getAnthropicModel('quality').then(setQualityModel);
    getAISuggestionsEnabled().then(setSuggestionsOn);
  }, []);

  const changeProvider = (next: AIProvider) => {
    setProvider(next);
    setAIProvider(next);
  };

  // --- Gemini save / remove ------------------------------------------------
  const saveGemini = async () => {
    const key = geminiInput.trim();
    if (!key) return;
    setGeminiStatus('testing');
    setGeminiError('');
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say "ok" and nothing else.' }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
        },
      );
      if (!res.ok) {
        if (res.status === 400) throw new Error('Invalid API key');
        if (res.status === 403) throw new Error('API key not authorized — check AI Studio');
        if (res.status === 429) throw new Error('Rate limit reached — try again in a minute');
        throw new Error(`Request failed (HTTP ${res.status})`);
      }
      await setGeminiApiKey(key);
      setGeminiSaved(key);
      setGeminiInput('');
      setGeminiStatus('idle');
      showToast({ message: 'Gemini API key saved' });
    } catch (e: any) {
      setGeminiStatus('error');
      setGeminiError(e?.message || 'Connection failed');
    }
  };

  const removeGemini = async () => {
    await clearGeminiApiKey();
    setGeminiSaved(null);
    setGeminiInput('');
    setGeminiStatus('idle');
    setGeminiError('');
    showToast({ message: 'Gemini API key removed' });
  };

  // --- Anthropic save / remove ---------------------------------------------
  const saveAnthropic = async () => {
    const key = anthInput.trim();
    if (!key) return;
    setAnthStatus('testing');
    setAnthError('');
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: fastModel,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        }),
      });
      if (!res.ok) throw new Error(anthropicErrorMessage(res.status));
      await setAnthropicApiKey(key);
      setAnthSaved(key);
      setAnthInput('');
      setAnthStatus('idle');
      showToast({ message: 'Claude API key saved' });
    } catch (e: any) {
      setAnthStatus('error');
      setAnthError(e?.message || 'Connection failed');
    }
  };

  const removeAnthropic = async () => {
    await clearAnthropicApiKey();
    setAnthSaved(null);
    setAnthInput('');
    setAnthStatus('idle');
    setAnthError('');
    showToast({ message: 'Claude API key removed' });
  };

  const changeModel = (tier: AIModelTier, id: string) => {
    if (tier === 'quality') setQualityModel(id);
    else setFastModel(id);
    setAnthropicModel(tier, id);
  };

  const toggleSuggestions = (next: boolean) => {
    setSuggestionsOn(next);
    setAISuggestionsEnabled(next);
  };

  const mask = (k: string) => k.slice(0, 6) + '…' + k.slice(-4);
  const activeKey = provider === 'anthropic' ? anthSaved : geminiSaved;

  return (
    <div className="space-y-6">
      {/* Provider picker */}
      <div>
        <h3 className="text-sm font-semibold text-fg-strong">AI provider</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Powers connection categorization, summaries, the insights chat, and reply drafting.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([
            { id: 'anthropic', name: 'Claude', note: 'Anthropic — recommended' },
            { id: 'gemini', name: 'Gemini', note: 'Google — free tier' },
          ] as const).map((p) => (
            <button
              key={p.id}
              onClick={() => changeProvider(p.id)}
              aria-pressed={provider === p.id}
              className={`rounded-lg px-3 py-2.5 text-left ring-1 transition-colors ${
                provider === p.id
                  ? 'bg-blue-600/10 ring-blue-500'
                  : 'bg-surface ring-ring hover:ring-fg-faint'
              }`}
            >
              <span className="block text-sm font-medium text-fg-strong">{p.name}</span>
              <span className="block text-xs text-fg-muted">{p.note}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Claude (Anthropic) */}
      {provider === 'anthropic' && (
        <div className="space-y-5 border-t border-edge pt-5">
          <div>
            <h3 className="text-sm font-semibold text-fg-strong">Claude API key</h3>
            {anthSaved ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-md bg-surface px-3 py-1.5 font-mono text-sm text-fg-secondary ring-1 ring-ring">
                  {mask(anthSaved)}
                </span>
                <span className="text-xs text-green-500">Active</span>
                <button
                  onClick={removeAnthropic}
                  className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="mt-3">
                <div className="rounded-lg bg-surface p-3 ring-1 ring-ring">
                  <p className="text-xs font-semibold text-fg-strong">Get an API key</p>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-fg-secondary marker:text-fg-faint">
                    <li>
                      Open{' '}
                      <a
                        href="https://console.anthropic.com/settings/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-500 underline hover:text-blue-400"
                      >
                        the Anthropic Console
                      </a>{' '}
                      and sign in.
                    </li>
                    <li>
                      Click <span className="font-medium text-fg">Create Key</span> and copy it.
                    </li>
                    <li>Paste it below and click Save.</li>
                  </ol>
                  <p className="mt-2 text-[11px] text-fg-faint">
                    Requires a small amount of billing credit. Your key is stored only on this device
                    and sent directly to Anthropic.
                  </p>
                </div>

                <div className="relative mt-3">
                  <input
                    type={anthShow ? 'text' : 'password'}
                    value={anthInput}
                    onChange={(e) => {
                      setAnthInput(e.target.value);
                      setAnthStatus('idle');
                      setAnthError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && anthInput.trim()) saveAnthropic();
                    }}
                    placeholder="Paste your Claude API key (sk-ant-…)"
                    className="w-full rounded-md bg-surface px-3 py-2 pr-16 text-sm text-fg placeholder-fg-faint ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setAnthShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:text-fg-secondary"
                  >
                    {anthShow ? 'Hide' : 'Show'}
                  </button>
                </div>

                {anthStatus === 'error' && (
                  <p className="mt-2 text-xs text-red-500">{anthError || 'Test failed'}</p>
                )}

                <div className="mt-3 flex justify-end">
                  <button
                    onClick={saveAnthropic}
                    disabled={!anthInput.trim() || anthStatus === 'testing'}
                    className="rounded-md btn-primary px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
                  >
                    {anthStatus === 'testing' ? 'Verifying…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Model tiers */}
          <div className="space-y-4">
            <p className="text-xs text-fg-muted">
              Route cheap, high-volume work to a small model and reserve a stronger one for writing.
            </p>
            <ModelSelect
              label="Fast model"
              hint="Categorization, summaries, autocomplete — pick the cheapest that works."
              value={fastModel}
              onChange={(id) => changeModel('fast', id)}
            />
            <ModelSelect
              label="Quality model"
              hint="Drafting messages and the insights chat."
              value={qualityModel}
              onChange={(id) => changeModel('quality', id)}
            />
          </div>
        </div>
      )}

      {/* Gemini */}
      {provider === 'gemini' && (
        <div className="border-t border-edge pt-5">
          <h3 className="text-sm font-semibold text-fg-strong">Gemini API key</h3>
          <p className="mt-1 text-sm text-fg-secondary">
            Bring your own key&nbsp;&mdash; it&rsquo;s free and takes a minute.
          </p>

          {geminiSaved ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-md bg-surface px-3 py-1.5 font-mono text-sm text-fg-secondary ring-1 ring-ring">
                {mask(geminiSaved)}
              </span>
              <span className="text-xs text-green-500">Active</span>
              <button
                onClick={removeGemini}
                className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <div className="rounded-lg bg-surface p-3 ring-1 ring-ring">
                <p className="text-xs font-semibold text-fg-strong">Get a free API key</p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-fg-secondary marker:text-fg-faint">
                  <li>
                    Open{' '}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-500 underline hover:text-blue-400"
                    >
                      Google AI Studio
                    </a>{' '}
                    and sign in with a Google account.
                  </li>
                  <li>
                    Click <span className="font-medium text-fg">Create API key</span> (accept the
                    terms if prompted).
                  </li>
                  <li>Copy the generated key.</li>
                  <li>Paste it below and click Save.</li>
                </ol>
                <p className="mt-2 text-[11px] text-fg-faint">
                  Free tier: 500 requests/day. Your key is stored only on this device and sent
                  directly to Google.
                </p>
              </div>

              <div className="relative mt-3">
                <input
                  type={geminiShow ? 'text' : 'password'}
                  value={geminiInput}
                  onChange={(e) => {
                    setGeminiInput(e.target.value);
                    setGeminiStatus('idle');
                    setGeminiError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && geminiInput.trim()) saveGemini();
                  }}
                  placeholder="Paste your Gemini API key"
                  className="w-full rounded-md bg-surface px-3 py-2 pr-16 text-sm text-fg placeholder-fg-faint ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setGeminiShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:text-fg-secondary"
                >
                  {geminiShow ? 'Hide' : 'Show'}
                </button>
              </div>

              {geminiStatus === 'error' && (
                <p className="mt-2 text-xs text-red-500">{geminiError || 'Test failed'}</p>
              )}

              <div className="mt-3 flex justify-end">
                <button
                  onClick={saveGemini}
                  disabled={!geminiInput.trim() || geminiStatus === 'testing'}
                  className="rounded-md btn-primary px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {geminiStatus === 'testing' ? 'Verifying…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shared behavior toggles */}
      <div className="space-y-3 border-t border-edge pt-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg-strong">Categorize connections</p>
            <p className="text-xs text-fg-muted">
              {categorizeMode === 'auto'
                ? 'Automatically tag new connections after each sync.'
                : 'Only categorize when you ask (Categorize now / per-connection refresh).'}
            </p>
          </div>
          <div className="inline-flex shrink-0 rounded-lg bg-surface p-0.5 ring-1 ring-ring">
            {(['auto', 'manual'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setCategorizeMode(m)}
                aria-pressed={categorizeMode === m}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  categorizeMode === m ? 'bg-blue-500/20 text-blue-200' : 'text-fg-secondary hover:text-fg-strong'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <ToggleRow
          label="AI reply suggestions"
          description="Suggest replies and inline autocomplete while composing."
          checked={suggestionsOn}
          disabled={!activeKey}
          onChange={toggleSuggestions}
        />
        {!activeKey && (
          <p className="mt-2 text-[11px] text-fg-faint">Add an API key above to enable.</p>
        )}
      </div>
    </div>
  );
}
