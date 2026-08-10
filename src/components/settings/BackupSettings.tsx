import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import {
  isDirectoryPickerSupported,
  pickBackupDirectory,
  getSavedDirectoryName,
  clearBackupDirectory,
  readBackupFile,
} from '@/lib/backup-fs';
import {
  runBackup,
  getAutoBackupEnabled,
  setAutoBackupEnabled,
  getLastBackupAt,
} from '@/lib/backup-service';
import { restoreBackupFromText } from '@/lib/backup-io';
import { Toggle } from '@/components/common/Toggle';

function relativeTime(ts: number): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function BackupSettings() {
  const showToast = useUIStore((s) => s.showToast);
  const supported = isDirectoryPickerSupported();

  const [folder, setFolder] = useState<string | null>(null);
  const [autoBackup, setAuto] = useState(false);
  const [lastAt, setLastAt] = useState(0);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);

  useEffect(() => {
    getSavedDirectoryName().then(setFolder).catch(() => setFolder(null));
    setAuto(getAutoBackupEnabled());
    setLastAt(getLastBackupAt());
  }, []);

  const chooseFolder = async () => {
    try {
      const res = await pickBackupDirectory();
      if (res) {
        setFolder(res.name);
        showToast({ message: `Backups will save to “${res.name}”` });
      }
    } catch {
      // user dismissed the picker
    }
  };

  const backupNow = async () => {
    setBusy('backup');
    try {
      const res = await runBackup();
      setLastAt(Date.now());
      showToast({
        message:
          res.method === 'folder'
            ? `Backed up to “${res.folder}”`
            : 'Backup downloaded',
      });
    } catch (e: any) {
      showToast({ message: e?.message || 'Backup failed' });
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy('restore');
    try {
      const text = await readBackupFile();
      if (!text) return;
      const res = await restoreBackupFromText(text);
      showToast({
        message: res.crossAccount
          ? `Restored ${res.connections} connection(s) from another account`
          : `Restored ${res.connections} connection(s)`,
      });
    } catch (e: any) {
      showToast({ message: e?.message || 'Restore failed' });
    } finally {
      setBusy(null);
    }
  };

  const toggleAuto = (next: boolean) => {
    setAuto(next);
    setAutoBackupEnabled(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-fg-strong">Backup &amp; restore</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Save your connections and everything the AI derived (categories,
          interest tags, summaries) to a file you control. The file is versioned,
          so it restores correctly even after future updates.
        </p>
      </div>

      {/* Folder */}
      {supported ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg-strong">Backup folder</p>
            <p className="truncate text-xs text-fg-muted">
              {folder ? `Saving to “${folder}”` : 'No folder chosen — backups will download instead.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={chooseFolder}
              className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
            >
              {folder ? 'Change' : 'Choose folder'}
            </button>
            {folder && (
              <button
                onClick={() => {
                  clearBackupDirectory();
                  setFolder(null);
                }}
                className="rounded-md px-2 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg-secondary"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">
          This browser can&rsquo;t save to a chosen folder, so backups will download to your
          Downloads folder.
        </p>
      )}

      {/* Auto-backup */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-strong">Auto-back up after categorizing</p>
          <p className="text-xs text-fg-muted">
            Write a fresh backup automatically whenever the AI finishes tagging new connections.
          </p>
        </div>
        <Toggle
          label="Auto-back up after categorizing"
          checked={autoBackup}
          onChange={toggleAuto}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-5">
        <button
          onClick={backupNow}
          disabled={busy !== null}
          className="rounded-md btn-primary px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
        >
          {busy === 'backup' ? 'Backing up…' : 'Back up now'}
        </button>
        <button
          onClick={restore}
          disabled={busy !== null}
          className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong disabled:opacity-40"
        >
          {busy === 'restore' ? 'Restoring…' : 'Restore from file'}
        </button>
        <span className="ml-auto text-xs text-fg-faint">Last backup: {relativeTime(lastAt)}</span>
      </div>
    </div>
  );
}
