import { useState, useEffect, useRef as useReactRef, useCallback, useMemo, forwardRef } from 'react';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';

const FILE_ICONS: Record<string, string> = {
  'image': '🖼',
  'video': '🎬',
  'audio': '🎵',
  'application/pdf': '📄',
  'text': '📝',
};

function fileIcon(file: File): string {
  if (FILE_ICONS[file.type]) return FILE_ICONS[file.type];
  const major = file.type.split('/')[0];
  return FILE_ICONS[major] || '📎';
}

const DRAFT_KEY = 'inflow-drafts';
const SAVE_INTERVAL = 1000;

function loadDraft(conversationId: string): string {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    return drafts[conversationId] || '';
  } catch { return ''; }
}

function saveDraft(conversationId: string, text: string) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    if (text) {
      drafts[conversationId] = text;
    } else {
      delete drafts[conversationId];
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {}
}

/** Save attachment files to IndexedDB (blobs stored natively, no base64/quota issues). */
function saveDraftAttachments(conversationId: string, files: File[]) {
  if (files.length === 0) {
    db.draftAttachments.delete(conversationId).catch(() => {});
  } else {
    db.draftAttachments.put({
      conversationId,
      files: files as Blob[],
      names: files.map((f) => f.name),
      types: files.map((f) => f.type),
    }).catch((e) => console.warn('[inflow] Failed to save draft attachments:', e));
  }
}

/** Load attachment files from IndexedDB. */
async function loadDraftAttachments(conversationId: string): Promise<File[]> {
  try {
    const row = await db.draftAttachments.get(conversationId);
    if (!row?.files?.length) return [];
    return row.files.map((blob, i) =>
      new File([blob], row.names[i] || 'file', { type: row.types[i] || '' })
    );
  } catch {
    return [];
  }
}

interface ComposeBoxProps {
  conversationId: string;
}

export const ComposeBox = forwardRef<HTMLTextAreaElement, ComposeBoxProps>(
  ({ conversationId }, ref) => {
    const [body, setBody] = useState(() => loadDraft(conversationId));
    const [attachments, setAttachments] = useState<File[]>([]);
    const { sendMessage } = useOptimisticAction();
    const setComposeActive = useUIStore((s) => s.setComposeActive);
    const bodyRef = useReactRef(body);
    bodyRef.current = body;
    const textareaRef = useReactRef<HTMLTextAreaElement | null>(null);

    // Sync forwarded ref + local ref
    const setRefs = useCallback((el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    }, [ref]);

    // Auto-resize textarea to fit content
    const autoResize = useCallback(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }, []);

    // Re-measure when body changes (e.g. draft restore)
    useEffect(() => { autoResize(); }, [body, autoResize]);

    // Stable object URLs for image previews (created once per file, revoked on removal)
    const previewUrls = useMemo(() => {
      const map = new Map<File, string>();
      for (const file of attachments) {
        if (file.type.startsWith('image/')) map.set(file, URL.createObjectURL(file));
      }
      return map;
    }, [attachments]);

    // Revoke old URLs when attachments change
    const prevUrls = useReactRef<Map<File, string>>(new Map());
    useEffect(() => {
      for (const [file, url] of prevUrls.current) {
        if (!previewUrls.has(file)) URL.revokeObjectURL(url);
      }
      prevUrls.current = previewUrls;
    }, [previewUrls]);

    // Restore draft when switching conversations (text is sync, attachments are async)
    useEffect(() => {
      let cancelled = false;
      setBody(loadDraft(conversationId));
      setAttachments([]); // clear stale data immediately
      loadDraftAttachments(conversationId).then((files) => {
        if (!cancelled) setAttachments(files);
      });
      return () => { cancelled = true; };
    }, [conversationId]);

    // Listen for files dropped on the app window
    useEffect(() => {
      function onAttach(e: Event) {
        const detail = (e as CustomEvent).detail;
        // Accept both old format (File[]) and new format ({file, ...}[])
        const newFiles: File[] = Array.isArray(detail)
          ? detail[0] instanceof File ? detail : detail.map((d: any) => d.file)
          : [];
        if (!newFiles.length) return;

        setAttachments((prev) => {
          const next = [...prev, ...newFiles];
          saveDraftAttachments(conversationId, next);
          document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
          return next;
        });
      }
      document.addEventListener('inflow:attach-files', onAttach);
      return () => document.removeEventListener('inflow:attach-files', onAttach);
    }, [conversationId]);

    // Periodically save text draft to localStorage and notify ConversationRow
    useEffect(() => {
      const timer = setInterval(() => {
        saveDraft(conversationId, bodyRef.current);
        document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
      }, SAVE_INTERVAL);
      return () => {
        saveDraft(conversationId, bodyRef.current);
        document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
        clearInterval(timer);
      };
    }, [conversationId]);

    function removeAttachment(index: number) {
      setAttachments((prev) => {
        const next = prev.filter((_, j) => j !== index);
        saveDraftAttachments(conversationId, next);
        document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
        return next;
      });
    }

    async function handleSend() {
      const text = body.trim();
      const filesToSend = attachments.length > 0 ? [...attachments] : undefined;
      if (!text && !filesToSend) return;
      setBody('');
      setAttachments([]);
      saveDraft(conversationId, '');
      saveDraftAttachments(conversationId, []);
      document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
      // Reset textarea height
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      // Blur the textarea so focus returns to the conversation list for j/k navigation
      const ta = textareaRef.current;
      if (ta) ta.blur();
      setComposeActive(false);

      if (conversationId.startsWith('draft-')) {
        // Draft conversation → CREATE_CONVERSATION instead of SEND_MESSAGE
        await handleDraftSend(text, filesToSend);
      } else {
        await sendMessage(conversationId, text, filesToSend);
      }
    }

    async function handleDraftSend(text: string, files?: File[]) {
      const store = useUIStore.getState();

      try {
        // Get recipient URNs from the draft conversation in IndexedDB
        const draftConv = await db.conversations.get(conversationId);
        if (!draftConv) {
          store.showToast({ message: 'Draft conversation not found' });
          return;
        }

        // Convert files to base64 for bridge serialization
        let bridgeAttachments: { name: string; type: string; size: number; dataBase64: string }[] | undefined;
        if (files?.length) {
          bridgeAttachments = await Promise.all(
            files.map(
              (f) =>
                new Promise<{ name: string; type: string; size: number; dataBase64: string }>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const base64 = (reader.result as string).split(',')[1] || '';
                    resolve({ name: f.name, type: f.type, size: f.size, dataBase64: base64 });
                  };
                  reader.onerror = () => reject(reader.error);
                  reader.readAsDataURL(f);
                })
            )
          );
        }

        const res = await sendBridgeMessage({
          type: 'CREATE_CONVERSATION',
          recipientUrns: draftConv.participantUrns,
          body: text,
          ...(bridgeAttachments && { attachments: bridgeAttachments }),
        });

        if (res.success && res.data?.conversationId) {
          // Clean up draft conversation
          await db.conversations.delete(conversationId).catch(() => {});
          await db.draftAttachments.delete(conversationId).catch(() => {});

          // Trigger sync to load the new conversation
          sendBridgeMessage({ type: 'SYNC_CONVERSATIONS' }).catch(() => {});
          // Navigate to the real conversation
          setTimeout(() => {
            store.openThread(res.data.conversationId, 0);
          }, 500);
        } else {
          store.showToast({ message: res.error || 'Failed to send message' });
        }
      } catch {
        store.showToast({ message: 'Failed to send message' });
      }
    }

    // Listen for Cmd+Enter dispatch from keyboard manager
    useEffect(() => {
      function onSend() {
        handleSend();
      }
      document.addEventListener('inflow:send', onSend);
      return () => document.removeEventListener('inflow:send', onSend);
    }, [conversationId, body, attachments]);

    return (
      <div className="border-t border-edge p-3">
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((file, i) =>
              file.type.startsWith('image/') ? (
                <span
                  key={`${file.name}-${i}`}
                  className="group relative inline-block overflow-hidden rounded-md ring-1 ring-ring-muted"
                >
                  <img
                    src={previewUrls.get(file)}
                    alt={file.name}
                    className="h-16 w-16 cursor-zoom-in object-cover"
                    onClick={() => {
                      const url = previewUrls.get(file);
                      if (url) useUIStore.getState().openLightbox(url);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-black/60 text-[10px] leading-none text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    ×
                  </button>
                </span>
              ) : (
                <span
                  key={`${file.name}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-raised px-2 py-1 text-xs text-fg-muted ring-1 ring-ring-muted"
                >
                  <span>{fileIcon(file)}</span>
                  <span className="max-w-[140px] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="ml-0.5 cursor-pointer text-fg-faint hover:text-fg"
                  >
                    ×
                  </button>
                </span>
              )
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={setRefs}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              autoResize();
            }}
            onFocus={() => setComposeActive(true)}
            onBlur={() => setComposeActive(false)}
            placeholder="Write a reply... (R to focus)"
            rows={1}
            className="max-h-40 flex-1 resize-none rounded-lg bg-surface-input px-3 py-2 text-sm text-fg placeholder-fg-faint outline-none ring-1 ring-ring-muted transition-colors focus:ring-blue-500/50"
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []);
              if (files.length) {
                e.preventDefault();
                document.dispatchEvent(new CustomEvent('inflow:attach-files', { detail: files }));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                // Don't call handleSend() here — the global keyboard hook
                // dispatches 'inflow:send' which we already listen for.
                // Calling it here too would double-send.
              }
            }}
          />
          <button
            onClick={handleSend}
            disabled={!body.trim() && attachments.length === 0}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
            <span className="flex items-center gap-0.5 opacity-60">
              <kbd className="rounded border border-white/30 bg-white/10 px-1 py-0.5 font-mono text-[10px] leading-none">⌘</kbd>
              <kbd className="rounded border border-white/30 bg-white/10 px-1 py-0.5 font-mono text-[10px] leading-none">↵</kbd>
            </span>
          </button>
        </div>
      </div>
    );
  }
);

ComposeBox.displayName = 'ComposeBox';
