const STORAGE_KEY = 'geminiApiKey';

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
