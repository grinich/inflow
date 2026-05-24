import { useEffect } from 'react';
import { useUIStore } from '@/store/ui-store';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={close}
    >
      <img
        src={imageUrl}
        alt="Full size"
        className="lightbox-zoom-in max-h-[90vh] max-w-[90vw] cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}
