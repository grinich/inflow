import { useEffect } from 'react';
import { useUIStore } from '@/store/ui-store';
import { sanitizeUrl } from '@/lib/sanitize-url';

export function ImageLightbox() {
  const imageUrl = useUIStore((s) => s.lightboxImageUrl);
  const close = useUIStore((s) => s.closeLightbox);

  useEffect(() => {
    if (!imageUrl) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [imageUrl, close]);

  if (!imageUrl) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={close}
    >
      <img
        src={sanitizeUrl(imageUrl)}
        alt="Full size"
        onError={close}
        className="lightbox-zoom-in max-h-[90vh] max-w-[90vw] cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}
