/**
 * File-system side of backups. Uses the File System Access API so the user can
 * pick a real folder once and have inflow write backup files straight into it;
 * the chosen folder handle is persisted so later backups reuse it. Everything
 * degrades to a plain download / file-picker when the API isn't available.
 *
 * This module is browser-only (no logic worth unit-testing); the testable parts
 * — serialization, migration, merge — live in backup.ts / backup-io.ts.
 */

const FS_DB = 'inflow-fs';
const FS_STORE = 'handles';
const DIR_KEY = 'backupDir';

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
}

// --- tiny IndexedDB kv for the directory handle (handles are structured- ------
// cloneable, so they survive in IndexedDB across sessions) -------------------
function openFsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FS_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openFsDb();
  return new Promise((resolve) => {
    const tx = db.transaction(FS_STORE, 'readonly');
    const r = tx.objectStore(FS_STORE).get(key);
    r.onsuccess = () => resolve((r.result as T) ?? null);
    r.onerror = () => resolve(null);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openFsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_STORE, 'readwrite');
    tx.objectStore(FS_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

type PermState = 'granted' | 'denied' | 'prompt';
async function ensurePermission(handle: any): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  const res: PermState = await handle.requestPermission?.(opts);
  return res === 'granted';
}

/** Prompt for a folder and remember it for future backups. */
export async function pickBackupDirectory(): Promise<{ name: string } | null> {
  if (!isDirectoryPickerSupported()) return null;
  const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  await idbSet(DIR_KEY, handle);
  return { name: handle.name };
}

/** The remembered folder's name, if one is set and still accessible. */
export async function getSavedDirectoryName(): Promise<string | null> {
  const handle = await idbGet<any>(DIR_KEY);
  return handle?.name ?? null;
}

export async function clearBackupDirectory(): Promise<void> {
  await idbSet(DIR_KEY, null);
}

/**
 * Write backup text. Prefers the remembered folder (re-requesting permission if
 * needed); falls back to a download when unsupported or no folder is set.
 * Returns how the file was delivered.
 */
export async function writeBackup(
  filename: string,
  contents: string,
): Promise<{ method: 'folder' | 'download'; folder?: string }> {
  const handle = await idbGet<any>(DIR_KEY);
  if (handle && (await ensurePermission(handle))) {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close();
    return { method: 'folder', folder: handle.name };
  }
  downloadText(filename, contents);
  return { method: 'download' };
}

function downloadText(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prompt the user to choose a backup file and return its text. */
export async function readBackupFile(): Promise<string | null> {
  if (typeof (window as any).showOpenFilePicker === 'function') {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{ description: 'inflow backup', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    const file = await handle.getFile();
    return file.text();
  }
  // Fallback: hidden <input type="file">
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    };
    input.click();
  });
}
