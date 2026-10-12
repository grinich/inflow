// @vitest-environment jsdom
// The Settings modal consolidates AI, appearance, advanced, and about into one
// panel reached from the nav-rail gear (or ⌘,).
import '../dom-setup';

let mockSavedKey: string | null = null;
const setGeminiApiKey = vi.fn(async (k: string) => {
  mockSavedKey = k;
});
vi.mock('@/lib/ai-settings', () => ({
  getGeminiApiKey: vi.fn(async () => mockSavedKey),
  setGeminiApiKey: (k: string) => setGeminiApiKey(k),
  clearGeminiApiKey: vi.fn(async () => {
    mockSavedKey = null;
  }),
  getAISuggestionsEnabled: vi.fn(async () => true),
  setAISuggestionsEnabled: vi.fn(),
  getAIComposeHideWhenUnavailable: vi.fn(async () => false),
  setAIComposeHideWhenUnavailable: vi.fn(),
  getCategorizeMode: vi.fn(async () => 'auto'),
  setCategorizeMode: vi.fn(),
  // Provider defaults to Gemini so the existing Gemini-focused assertions hold.
  getAIProvider: vi.fn(async () => 'gemini'),
  setAIProvider: vi.fn(),
  getTierProvider: vi.fn(async () => 'gemini'),
  setTierProvider: vi.fn(),
  AI_MODEL_CATALOG: [
    { provider: 'gemini', id: 'gemini-3.1-flash-lite', label: 'Flash-Lite', blurb: 'cheap', recommendedFor: 'fast' },
    { provider: 'anthropic', id: 'claude-sonnet-5', label: 'Sonnet 5', blurb: 'balanced', recommendedFor: 'quality' },
  ],
  getAnthropicApiKey: vi.fn(async () => null),
  setAnthropicApiKey: vi.fn(),
  clearAnthropicApiKey: vi.fn(),
  getAnthropicModel: vi.fn(async (tier: string) =>
    tier === 'quality' ? 'claude-sonnet-5' : 'claude-haiku-4-5',
  ),
  setAnthropicModel: vi.fn(),
  getGeminiModel: vi.fn(async (tier: string) =>
    tier === 'quality' ? 'gemini-3.1-pro-preview' : 'gemini-3.1-flash-lite',
  ),
  setGeminiModel: vi.fn(),
  getAIChatMaxWords: vi.fn(async () => 0),
  setAIChatMaxWords: vi.fn(),
  getAIChatInstructions: vi.fn(async () => ''),
  setAIChatInstructions: vi.fn(),
  getAIChatAppendInstructions: vi.fn(async () => ''),
  setAIChatAppendInstructions: vi.fn(),
  DEFAULT_CHAT_MAX_WORDS: 0,
  CHAT_MAX_WORDS_MIN: 0,
  CHAT_MAX_WORDS_MAX: 8000,
  CHAT_INSTRUCTIONS_MAX_CHARS: 4000,
  CHAT_APPEND_MAX_CHARS: 2000,
  getChatPrompts: vi.fn(async () => ['Which of my connections are investors?']),
  setChatPrompts: vi.fn(),
  DEFAULT_CHAT_PROMPTS: ['Which of my connections are investors?'],
  CHAT_PROMPTS_MAX: 12,
  CHAT_PROMPT_MAX_CHARS: 200,
  ANTHROPIC_MODELS: [
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', blurb: 'cheap' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', blurb: 'balanced' },
    { id: 'claude-opus-5', label: 'Opus 5', blurb: 'best' },
  ],
  GEMINI_MODELS: [
    { id: 'gemini-3.1-flash-lite', label: 'Flash-Lite', blurb: 'cheap' },
    { id: 'gemini-3.1-flash', label: 'Flash', blurb: 'balanced' },
    { id: 'gemini-3.1-pro-preview', label: 'Pro', blurb: 'best' },
  ],
}));

import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useUIStore } from '@/store/ui-store';
import * as aiSettings from '@/lib/ai-settings';

async function openSettings(section?: 'ai' | 'appearance' | 'advanced' | 'about') {
  render(<SettingsModal />);
  await act(async () => {
    useUIStore.getState().openSettings(section);
  });
}

beforeEach(() => {
  mockSavedKey = null;
  setGeminiApiKey.mockClear();
  // Default: Gemini for both tiers, companion disconnected.
  vi.mocked(aiSettings.getTierProvider).mockImplementation(async () => 'gemini');
  act(() =>
    useUIStore.setState({
      settingsOpen: false,
      settingsSection: 'ai',
      mcpStatus: 'disconnected',
      mcpKeys: { anthropic: false, gemini: false },
    }),
  );
});

it('is hidden until opened', () => {
  render(<SettingsModal />);
  expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
});

it('opens on the AI section with get-a-key instructions and a Studio link', async () => {
  await openSettings();
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

  expect(await screen.findByText(/Get a free API key/i)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: /Google AI Studio/i });
  expect(link).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  expect(screen.getByText(/500 requests\/day/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/Paste your Gemini API key/i)).toBeInTheDocument();
});

it('verifies then saves a pasted key', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await openSettings('ai');
  const input = await screen.findByPlaceholderText(/Paste your Gemini API key/i);
  fireEvent.change(input, { target: { value: 'AIzaTEST123' } });
  // The AI section now has its own (disabled-until-dirty) response-settings Save
  // too — pick the enabled key Save.
  const save = screen
    .getAllByRole('button', { name: 'Save' })
    .find((b) => !(b as HTMLButtonElement).disabled)!;
  fireEvent.click(save);

  await waitFor(() => expect(setGeminiApiKey).toHaveBeenCalledWith('AIzaTEST123'));
  expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');

  vi.unstubAllGlobals();
});

it('toggles categorization between auto and manual', async () => {
  await openSettings('ai');
  fireEvent.click(await screen.findByRole('button', { name: 'manual' }));
  expect(aiSettings.setCategorizeMode).toHaveBeenCalledWith('manual');
});

it('Chat section: shows "Your instructions" and reveals the default prompt with a warning', async () => {
  await openSettings('chat' as any);
  // The user's on-top instructions layer is visible.
  expect(await screen.findByText('Your instructions')).toBeInTheDocument();
  // The default prompt is behind an advanced disclosure — warning hidden until opened.
  expect(screen.queryByText(/future app updates won’t change your copy/i)).toBeFalsy();
  fireEvent.click(screen.getByRole('button', { name: /Default prompt/i }));
  expect(await screen.findByText(/future app updates won’t change your copy/i)).toBeInTheDocument();
});

it('switches to Appearance and changes the theme on Save', async () => {
  await openSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

  const dark = await screen.findByRole('button', { name: 'Dark' });
  fireEvent.click(dark);
  // Draft only — theme is not applied until Save.
  expect(useUIStore.getState().theme).not.toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  expect(useUIStore.getState().theme).toBe('dark');
});

it('Drafts section: an on-by-default switch, matching every other setting', async () => {
  await openSettings('sending');

  // A switch, not a checkbox: every other toggle in settings is the shared
  // Toggle component, and this one was hand-rolled as an <input> at first.
  const toggle = await screen.findByRole('switch', {
    name: /Confirm the person before sending Claude's InMail drafts/i,
  });
  expect(toggle.getAttribute('aria-checked')).toBe('true');

  fireEvent.click(toggle);
  expect(useUIStore.getState().confirmRecipient).toBe(false);
  expect(toggle.getAttribute('aria-checked')).toBe('false');

  fireEvent.click(toggle);
  expect(useUIStore.getState().confirmRecipient).toBe(true);
});

it('shows the Demo mode control', async () => {
  await openSettings('advanced');
  expect(await screen.findByText(/Browse a synthetic inbox/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /enter demo mode|exit demo mode/i })).toBeInTheDocument();
});

it('AI section: connector status reads "Not connected" when the companion is down', async () => {
  await openSettings('ai');
  expect(await screen.findByText(/MCP connector: Not connected/i)).toBeInTheDocument();
});

it('AI section: when the companion holds the Claude key, shows it active and hides the paste box', async () => {
  // Quality tier = Claude so the Claude key section renders.
  vi.mocked(aiSettings.getTierProvider).mockImplementation(async (tier) =>
    tier === 'quality' ? 'anthropic' : 'gemini',
  );
  act(() => useUIStore.setState({ mcpStatus: 'connected', mcpKeys: { anthropic: true, gemini: false } }));

  await openSettings('ai');

  // Connector status line reflects the live connection.
  expect(await screen.findByText(/MCP connector: Connected/i)).toBeInTheDocument();
  expect(screen.getByText(/Running Claude server-side/i)).toBeInTheDocument();

  // Claude key shows as active in the companion, and the paste box is gone.
  expect(screen.getByText(/Active · in the MCP connector/i)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/Paste your Claude API key/i)).not.toBeInTheDocument();

  // "Use a browser key instead" reveals the paste box on demand.
  fireEvent.click(screen.getByRole('button', { name: /Use a browser key instead/i }));
  expect(await screen.findByPlaceholderText(/Paste your Claude API key/i)).toBeInTheDocument();
});

it('closes on the close button and via Escape', async () => {
  await openSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  expect(useUIStore.getState().settingsOpen).toBe(false);

  await act(async () => useUIStore.getState().openSettings());
  expect(useUIStore.getState().settingsOpen).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(useUIStore.getState().settingsOpen).toBe(false));
});
