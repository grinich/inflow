import { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import { getGeminiApiKey, setGeminiApiKey, clearGeminiApiKey } from '@/lib/ai-settings';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export function AISetupModal() {
  const open = useUIStore((s) => s.aiSetupOpen);
  const setOpen = useUIStore((s) => s.setAISetupOpen);
  const showToast = useUIStore((s) => s.showToast);

  const [apiKey, setApiKey] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState('');

  // Load saved key when opening
  useEffect(() => {
    if (open) {
      getGeminiApiKey().then((key) => {
        setSavedKey(key);
        setApiKey('');
        setShowKey(false);
        setTestStatus('idle');
        setTestError('');
      });
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), [setOpen]);

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

  const handleSave = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setTestStatus('testing');
    setTestError('');
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
        const status = res.status;
        if (status === 400) throw new Error('Invalid API key');
        if (status === 403) throw new Error('API key not authorized — check AI Studio');
        if (status === 429) throw new Error('Rate limit reached — try again in a minute');
        throw new Error(`Request failed (HTTP ${status})`);
      }
      await setGeminiApiKey(key);
      setSavedKey(key);
      setApiKey('');
      showToast({ message: 'Gemini API key saved' });
      close();
    } catch (e: any) {
      setTestStatus('error');
      setTestError(e?.message || 'Connection failed');
    }
  };

  const handleRemove = async () => {
    await clearGeminiApiKey();
    setSavedKey(null);
    setApiKey('');
    setTestStatus('idle');
    setTestError('');
    showToast({ message: 'Gemini API key removed' });
  };

  if (!open) return null;

  const maskedKey = savedKey ? savedKey.slice(0, 4) + '\u2026' + savedKey.slice(-4) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div
        className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-fg-strong">Set up AI Features</h2>
        <p className="mt-2 text-sm text-fg-secondary">
          Inflow uses Gemini for inline autocomplete. Paste an API key from{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 underline hover:text-blue-400"
          >
            Google AI Studio
          </a>{' '}
          (free tier, 500 req/day).
        </p>

        {savedKey ? (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-surface px-3 py-1.5 font-mono text-sm text-fg-secondary ring-1 ring-ring">
                {maskedKey}
              </span>
              <span className="text-xs text-green-500">Active</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={close}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
              >
                Close
              </button>
              <button
                onClick={handleRemove}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestStatus('idle');
                  setTestError('');
                }}
                placeholder="Paste your Gemini API key"
                className="w-full rounded-md bg-surface px-3 py-2 pr-16 text-sm text-fg placeholder-fg-faint ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:text-fg-secondary"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>

            {testStatus === 'error' && (
              <p className="mt-2 text-xs text-red-500">{testError || 'Test failed'}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={close}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!apiKey.trim() || testStatus === 'testing'}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
              >
                {testStatus === 'testing' ? 'Verifying\u2026' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
