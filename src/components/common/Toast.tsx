import { useState, useEffect, useRef } from 'react';
import { useUIStore } from '@/store/ui-store';

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  const dismissToast = useUIStore((s) => s.dismissToast);

  // Keep the toast mounted during exit animation
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const lastToast = useRef(toast);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (toast) {
      // New toast appearing
      lastToast.current = toast;
      setExiting(false);
      // Trigger enter on next frame so transition fires
      requestAnimationFrame(() => setVisible(true));
    } else if (lastToast.current) {
      // Toast removed — start exit animation
      setExiting(true);
      setVisible(false);
      exitTimer.current = setTimeout(() => {
        setExiting(false);
        lastToast.current = null;
      }, 200);
    }
    return () => { if (exitTimer.current) clearTimeout(exitTimer.current); };
  }, [toast]);

  const current = toast ?? lastToast.current;
  if (!current) return null;

  return (
    <div className="fixed top-4 left-[calc(50%+192px)] -translate-x-1/2 z-50">
      <div
        className={`flex items-center gap-3 rounded-lg bg-surface-raised px-4 py-2.5 text-sm text-fg shadow-xl ring-1 ring-ring transition-all duration-200 ease-out ${
          visible && !exiting
            ? 'translate-y-0 opacity-100'
            : '-translate-y-2 opacity-0'
        }`}
      >
        <span>{current.message}</span>
        {current.undoAction && (
          <button
            onClick={() => {
              current.undoAction?.();
              dismissToast();
            }}
            className="font-medium text-blue-400 transition-colors hover:text-blue-300"
          >
            Undo
            <span className="ml-1 text-xs text-fg-muted">Z</span>
          </button>
        )}
      </div>
    </div>
  );
}
