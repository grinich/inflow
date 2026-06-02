const STORAGE_KEY = 'geminiApiKey';
const SUGGESTIONS_KEY = 'aiSuggestionsEnabled';

export async function getGeminiApiKey(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as string) || null;
  } catch {
    return null;
  }
}

export async function setGeminiApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: key });
}

export async function clearGeminiApiKey(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export async function getAISuggestionsEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(SUGGESTIONS_KEY);
    // Default to true if not set
    return result[SUGGESTIONS_KEY] !== false;
  } catch {
    return true;
  }
}

export async function setAISuggestionsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [SUGGESTIONS_KEY]: enabled });
}
