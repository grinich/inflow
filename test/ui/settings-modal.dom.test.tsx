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
  getCategorizeMode: vi.fn(async () => 'auto'),
  setCategorizeMode: vi.fn(),
  // Provider defaults to Gemini so the existing Gemini-focused assertions hold.
  getAIProvider: vi.fn(async () => 'gemini'),
  setAIProvider: vi.fn(),
  getAnthropicApiKey: vi.fn(async () => null),
  setAnthropicApiKey: vi.fn(),
  clearAnthropicApiKey: vi.fn(),
  getAnthropicModel: vi.fn(async (tier: string) =>
    tier === 'quality' ? 'claude-sonnet-5' : 'claude-haiku-4-5',
  ),
  setAnthropicModel: vi.fn(),
  ANTHROPIC_MODELS: [
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', blurb: 'cheap' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', blurb: 'balanced' },
    { id: 'claude-opus-5', label: 'Opus 5', blurb: 'best' },
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
  act(() => useUIStore.setState({ settingsOpen: false, settingsSection: 'ai' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(setGeminiApiKey).toHaveBeenCalledWith('AIzaTEST123'));
  expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');

  vi.unstubAllGlobals();
});

it('toggles categorization between auto and manual', async () => {
  await openSettings('ai');
  fireEvent.click(await screen.findByRole('button', { name: 'manual' }));
  expect(aiSettings.setCategorizeMode).toHaveBeenCalledWith('manual');
});

it('switches to Appearance and changes the theme', async () => {
  await openSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

  const dark = await screen.findByRole('button', { name: 'Dark' });
  fireEvent.click(dark);
  expect(useUIStore.getState().theme).toBe('dark');
});

it('shows the Advanced demo-mode control', async () => {
  await openSettings('advanced');
  expect(await screen.findByText('Demo mode')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /demo mode/i })).toBeInTheDocument();
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
