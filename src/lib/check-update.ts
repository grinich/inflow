import { sendBridgeMessage } from './bridge';
import { isNewerVersion, coreVersion, type UpdateStatus } from './update';

/**
 * Run a manual "check for updates": ask the background worker for the latest
 * release, compare against the running manifest version, and surface the result
 * as a toast. Opens the release page when a newer version is available.
 *
 * Shared by the command palette and the Settings → About section so both behave
 * identically.
 */
export async function checkForUpdateAndToast(
  showToast: (t: { message: string }) => void,
): Promise<void> {
  showToast({ message: 'Checking for updates…' });

  let status: UpdateStatus | null = null;
  try {
    const res = await sendBridgeMessage({ type: 'CHECK_FOR_UPDATE' });
    status = (res.success ? res.data : null) as UpdateStatus | null;
  } catch {
    status = null;
  }

  if (!status) {
    showToast({ message: "Couldn't check for updates — try again later" });
    return;
  }
  const current = coreVersion(chrome?.runtime?.getManifest?.().version ?? '0.0.0');
  if (isNewerVersion(status.latestVersion, current)) {
    showToast({ message: `Update available: v${status.latestVersion}` });
    if (status.releaseUrl) window.open(status.releaseUrl, '_blank');
  } else {
    showToast({ message: `inflow is up to date (v${current})` });
  }
}
