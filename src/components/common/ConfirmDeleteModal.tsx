import { useEffect } from 'react';

interface ConfirmDeleteModalProps {
  participantNames: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteModal({ participantNames, onConfirm, onCancel }: ConfirmDeleteModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onConfirm, onCancel]);

  const name = participantNames.length > 0
    ? participantNames.join(', ')
    : 'this conversation';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl bg-surface-raised p-6 shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-fg-strong">Delete conversation</h2>
        <p className="mt-2 text-sm text-fg-secondary">
          Permanently delete your conversation with <span className="font-medium text-fg-strong">{name}</span>? This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
          >
            Cancel <kbd className="ml-1 rounded border border-edge bg-surface px-1 py-px font-mono text-[10px] text-fg-faint">esc</kbd>
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Delete <kbd className="ml-1 rounded border border-red-500 px-1 py-px font-mono text-[10px] text-red-200">enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
