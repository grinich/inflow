import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { sanitizeUrl } from '@/lib/sanitize-url';

/**
 * Full-window modal video player for message video attachments.
 *
 * LinkedIn's messaging video URLs (www.linkedin.com/dms/prv/vid/...) are
 * signed AND cookie-authenticated. The extension holds host permissions for
 * www.linkedin.com, so a plain fetch from the app page is credentialed — the
 * same way useCachedImage loads dms images — while a <video src> pointed
 * straight at the URL would be an uncredentialed media request and can 401.
 * So the bytes are fetched first and played from a blob URL.
 */
export function VideoLightbox() {
  const videoUrl = useUIStore((s) => s.lightboxVideoUrl);
  const close = useUIStore((s) => s.closeVideoLightbox);

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!videoUrl) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [videoUrl, close]);

  useEffect(() => {
    if (!videoUrl) return;
    setFailed(false);
    setBlobUrl(null);

    const controller = new AbortController();
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(videoUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [videoUrl]);

  if (!videoUrl) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Video player"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={close}
    >
      {blobUrl ? (
        <video
          src={blobUrl}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          className="lightbox-zoom-in max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
        />
      ) : failed ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex flex-col items-center gap-3 rounded-lg bg-surface-raised px-6 py-5 text-sm text-fg-secondary shadow-2xl"
        >
          <p>Couldn't load the video — the link may have expired.</p>
          <a
            href={sanitizeUrl(videoUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 underline hover:text-blue-600"
          >
            Open on LinkedIn
          </a>
        </div>
      ) : (
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fg-faint border-t-blue-500" />
      )}
    </div>
  );
}
