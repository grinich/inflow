import { readLocal } from './storage';

const STORAGE_KEY = 'geminiApiKey';
const SUGGESTIONS_KEY = 'aiSuggestionsEnabled';

export async function getGeminiApiKey(): Promise<string | null> {
  return (await readLocal<string>(STORAGE_KEY)) || null;
}

export async function setGeminiApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: key });
}

export async function clearGeminiApiKey(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export async function getAISuggestionsEnabled(): Promise<boolean> {
  // Default to true if not set (and on read error, readLocal yields undefined).
  return (await readLocal<boolean>(SUGGESTIONS_KEY)) !== false;
}

export async function setAISuggestionsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [SUGGESTIONS_KEY]: enabled });
}
