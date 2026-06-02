import { useState, useEffect, useRef as useReactRef, useCallback, useMemo, forwardRef } from 'react';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import { searchEmoji, type EmojiResult } from '@/lib/emoji-search';
import { EmojiAutocomplete } from './EmojiAutocomplete';
import { useAutocomplete } from '@/hooks/useAutocomplete';
import { useReplySuggestions } from '@/hooks/useReplySuggestions';
import type { Message } from '@/types/message';

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

const SAVE_INTERVAL = 1000;

/** Save draft text and/or attachments to IndexedDB in a single row. */
function saveDraft(conversationId: string, text: string, files: File[]) {
  if (!text && files.length === 0) {
    db.draftAttachments.delete(conversationId).catch(() => {});
  } else {
    db.draftAttachments.put({
      conversationId,
      text: text || undefined,
      files: files as Blob[],
      names: files.map((f) => f.name),
      types: files.map((f) => f.type),
    }).catch((e) => console.warn('[inflow] Failed to save draft:', e));
  }
}

/** Load draft text and attachment files from IndexedDB. */
async function loadDraft(conversationId: string): Promise<{ text: string; files: File[] }> {
  try {
    const row = await db.draftAttachments.get(conversationId);
    if (!row) return { text: '', files: [] };
    const files = (row.files?.length)
      ? row.files.map((blob, i) => new File([blob], row.names[i] || 'file', { type: row.types[i] || '' }))
      : [];
    return { text: row.text || '', files };
  } catch {
    return { text: '', files: [] };
  }
}

interface ComposeBoxProps {
  conversationId: string;
  messages?: Message[];
  participantNames?: string[];
}

export const ComposeBox = forwardRef<HTMLTextAreaElement, ComposeBoxProps>(
  ({ conversationId, messages = [], participantNames = [] }, ref) => {
    const [body, setBody] = useState('');
    const [attachments, setAttachments] = useState<File[]>([]);
    const { sendMessage, sendAndArchive, archiveConversation } = useOptimisticAction();
    const setComposeActive = useUIStore((s) => s.setComposeActive);
    const replyingTo = useUIStore((s) => s.replyingTo);
    const setReplyingTo = useUIStore((s) => s.setReplyingTo);
    const [cmdHeld, setCmdHeld] = useState(false);
    const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
    const [emojiIndex, setEmojiIndex] = useState(0);
    const emojiResults = useMemo(
      () => (emojiQuery !== null ? searchEmoji(emojiQuery) : []),
      [emojiQuery],
    );

    const bodyRef = useReactRef(body);
    bodyRef.current = body;
    const attachmentsRef = useReactRef(attachments);
    attachmentsRef.current = attachments;
    const textareaRef = useReactRef<HTMLTextAreaElement | null>(null);

    const [cursorAtEnd, setCursorAtEnd] = useState(true);
    const emojiOpen = emojiQuery !== null && emojiResults.length > 0;

    const autocomplete = useAutocomplete({
      body,
      cursorAtEnd,
      emojiOpen,
      messages,
      participantNames,
      conversationId,
      textareaRef,
      setBody,
    });

    const replySuggestions = useReplySuggestions({
      conversationId,
      messages,
      participantNames,
      body,
    });

    useEffect(() => {
      const isFocused = () => document.activeElement === textareaRef.current;
      const down = (e: KeyboardEvent) => { if ((e.key === 'Meta' || e.key === 'Control') && isFocused()) setCmdHeld(true); };
      const up = (e: KeyboardEvent) => { if (e.key === 'Meta' || e.key === 'Control') setCmdHeld(false); };
      const blur = () => setCmdHeld(false);
      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);
      window.addEventListener('blur', blur);
      return () => {
        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', up);
        window.removeEventListener('blur', blur);
      };
    }, []);

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

    // Revoke any remaining preview URLs when the compose box unmounts (e.g.
    // navigating away without sending) so the blob URLs don't leak.
    useEffect(() => () => {
      for (const url of prevUrls.current.values()) URL.revokeObjectURL(url);
    }, []);

    // Restore draft when switching conversations
    useEffect(() => {
      let cancelled = false;
      setBody('');
      setAttachments([]);
      setReplyingTo(null);
      loadDraft(conversationId).then((draft) => {
        if (cancelled) return;
        setBody(draft.text);
        setAttachments(draft.files);
      });
      return () => { cancelled = true; };
    }, [conversationId]);

    // Auto-focus textarea when reply is selected
    useEffect(() => {
      if (replyingTo && textareaRef.current) {
        textareaRef.current.focus();
      }
    }, [replyingTo]);

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
          saveDraft(conversationId, bodyRef.current, next);
          document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
          return next;
        });
      }
      document.addEventListener('inflow:attach-files', onAttach);
      return () => document.removeEventListener('inflow:attach-files', onAttach);
    }, [conversationId]);

    // Periodically save draft to IndexedDB and notify ConversationRow
    useEffect(() => {
      const timer = setInterval(() => {
        saveDraft(conversationId, bodyRef.current, attachmentsRef.current);
        document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
      }, SAVE_INTERVAL);
      return () => {
        saveDraft(conversationId, bodyRef.current, attachmentsRef.current);
        document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
        clearInterval(timer);
      };
    }, [conversationId]);

    function removeAttachment(index: number) {
      setAttachments((prev) => {
        const next = prev.filter((_, j) => j !== index);
        saveDraft(conversationId, bodyRef.current, next);
        document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
        return next;
      });
    }

    function insertEmoji(result: EmojiResult) {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = ta.selectionStart ?? body.length;
      const before = body.slice(0, pos);
      // Find the colon that started this query
      const colonIdx = before.lastIndexOf(':');
      if (colonIdx === -1) return;
      const newBody = body.slice(0, colonIdx) + result.emoji + body.slice(pos);
      setBody(newBody);
      setEmojiQuery(null);
      // Restore cursor position after the inserted emoji
      const newPos = colonIdx + result.emoji.length;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newPos, newPos);
      });
    }

    async function handleSend() {
      const text = body.trim();
      const filesToSend = attachments.length > 0 ? [...attachments] : undefined;
      if (!text && !filesToSend) return;

      // Read reply state directly from store to avoid stale closure
      // (the inflow:send event listener may hold an old handleSend reference)
      const currentReply = useUIStore.getState().replyingTo;

      setBody('');
      setAttachments([]);
      useUIStore.getState().setReplyingTo(null);
      saveDraft(conversationId, '', []);
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
        // Build replyTo payload from the replyingTo message
        const replyTo = currentReply ? {
          messageUrn: currentReply.id,
          senderUrn: currentReply.senderUrn,
          senderName: currentReply.senderName,
          sentAt: currentReply.createdAt,
          body: currentReply.body,
        } : undefined;
        await sendMessage(conversationId, text, filesToSend, replyTo);
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

    // Listen for send (Enter) and send+archive (Cmd+Enter) from keyboard manager
    useEffect(() => {
      function onSend() {
        handleSend();
      }
      function onSendAndArchive() {
        const text = body.trim();
        const filesToSend = attachments.length > 0 ? [...attachments] : undefined;
        if (!text && !filesToSend) return;
        // Capture reply state before clearing
        const currentReply = useUIStore.getState().replyingTo;
        // Clear compose state immediately
        setBody('');
        setAttachments([]);
        setReplyingTo(null);
        saveDraft(conversationId, '', []);
        document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        const ta = textareaRef.current;
        if (ta) ta.blur();
        setComposeActive(false);
        // Atomic send+archive — archives first, then sends in background
        const replyToData = currentReply ? {
          messageUrn: currentReply.id,
          senderUrn: currentReply.senderUrn,
          senderName: currentReply.senderName,
          sentAt: currentReply.createdAt,
          body: currentReply.body,
        } : undefined;
        sendAndArchive(conversationId, text, filesToSend, replyToData);
      }
      document.addEventListener('inflow:send', onSend);
      document.addEventListener('inflow:send-and-archive', onSendAndArchive);
      return () => {
        document.removeEventListener('inflow:send', onSend);
        document.removeEventListener('inflow:send-and-archive', onSendAndArchive);
      };
    }, [conversationId, body, attachments]);

    const hasContent = !!(body.trim() || attachments.length > 0);

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

        {/* Reply preview banner */}
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-blue-400 bg-surface-raised px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-fg-secondary">
                Reply to {replyingTo.senderName}
              </p>
              <p className="truncate text-xs text-fg-muted opacity-70">
                {replyingTo.body || (replyingTo.attachments?.length ? 'Attachment' : '')}
              </p>
            </div>
            {/* Image thumbnail if original has image attachments */}
            {replyingTo.attachments?.find(a => a.type === 'image' && a.imageUrl) && (
              <img
                src={replyingTo.attachments.find(a => a.type === 'image' && a.imageUrl)!.imageUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded object-cover"
              />
            )}
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="shrink-0 cursor-pointer text-fg-faint hover:text-fg-secondary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* AI reply suggestion chips */}
        {body.length === 0 && (replySuggestions.suggestions.length > 0 || replySuggestions.isLoading) && (
          <div className="mb-2 flex gap-1.5">
            {replySuggestions.isLoading ? (
              <>
                <span className="h-6 w-20 animate-pulse rounded-full bg-surface-raised ring-1 ring-ring-muted" />
                <span className="h-6 w-24 animate-pulse rounded-full bg-surface-raised ring-1 ring-ring-muted" />
                <span className="h-6 w-16 animate-pulse rounded-full bg-surface-raised ring-1 ring-ring-muted" />
              </>
            ) : (
              replySuggestions.suggestions.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => {
                    setBody(text);
                    replySuggestions.clear();
                    textareaRef.current?.focus();
                  }}
                  className="cursor-pointer rounded-full bg-surface-raised px-3 py-1 text-xs text-fg-secondary ring-1 ring-ring-muted transition-colors hover:bg-surface-hover"
                >
                  {text}
                </button>
              ))
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className={`relative flex flex-1 items-end ${autocomplete.isOpen ? 'rounded-lg bg-surface-input ring-1 ring-ring-muted' : ''}`}>
          {autocomplete.suggestion && (
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg px-3 py-2 text-sm"
              style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
            >
              <span style={{ visibility: 'hidden' }}>{body}</span>
              <span className="text-zinc-500">{autocomplete.suggestion}</span>
            </div>
          )}
          <textarea
            ref={setRefs}
            value={body}
            onChange={(e) => {
              const val = e.target.value;
              setBody(val);
              autoResize();
              // Track whether cursor is at the end of the text
              const pos = e.target.selectionStart ?? val.length;
              setCursorAtEnd(pos === val.length);
              // Detect emoji shortcode: `:` followed by valid chars before cursor
              const before = val.slice(0, pos);
              const match = before.match(/:([a-z0-9_+-]*)$/);
              if (match) {
                setEmojiQuery(match[1]);
                setEmojiIndex(0);
              } else {
                setEmojiQuery(null);
              }
            }}
            onFocus={() => setComposeActive(true)}
            onBlur={() => { setComposeActive(false); setEmojiQuery(null); }}
            placeholder="Reply..."
            rows={2}
            data-emoji-open={emojiOpen ? '' : undefined}
            data-autocomplete-open={autocomplete.isOpen || undefined}
            className={`max-h-40 w-full resize-none rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-faint outline-none transition-colors ${autocomplete.isOpen ? 'bg-transparent ring-0' : 'bg-surface-input ring-1 ring-ring-muted focus:ring-blue-500/50'}`}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []);
              if (files.length) {
                e.preventDefault();
                document.dispatchEvent(new CustomEvent('inflow:attach-files', { detail: files }));
              }
            }}
            onKeyDown={(e) => {
              // Emoji autocomplete keyboard handling (when popup is open)
              if (emojiQuery !== null && emojiResults.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEmojiIndex((i) => (i + 1) % emojiResults.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEmojiIndex((i) => (i - 1 + emojiResults.length) % emojiResults.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  e.stopPropagation();
                  insertEmoji(emojiResults[emojiIndex]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEmojiQuery(null);
                  return;
                }
              }
              // AI autocomplete keyboard handling
              if (autocomplete.isOpen) {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  e.stopPropagation();
                  autocomplete.accept();
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  autocomplete.dismiss();
                  return;
                }
              }
              // Escape dismisses reply preview
              if (e.key === 'Escape' && useUIStore.getState().replyingTo) {
                e.preventDefault();
                e.stopPropagation();
                setReplyingTo(null);
                return;
              }
              // All Enter variants are handled by the global keyboard hook
              // (useKeyboard.ts) which dispatches custom events. Prevent
              // default here to stop the textarea from inserting a newline
              // on plain Enter and Cmd+Enter. Shift+Enter is left alone.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
              }
            }}
          />
          {!body && (
            <kbd className="pointer-events-none absolute left-[4.25rem] top-[0.6rem] rounded border border-ring-muted bg-surface px-1.5 py-0.5 font-mono text-[10px] leading-none text-fg-faint">
              R
            </kbd>
          )}
          {emojiQuery !== null && emojiResults.length > 0 && (
            <EmojiAutocomplete
              results={emojiResults}
              selectedIndex={emojiIndex}
              query={emojiQuery}
              onSelect={insertEmoji}
              onClose={() => setEmojiQuery(null)}
            />
          )}
          </div>
          <button
            onClick={() => {
              if (cmdHeld) {
                // Trigger send+archive via the same path as Cmd+Enter
                document.dispatchEvent(new CustomEvent('inflow:send-and-archive'));
              } else {
                handleSend();
              }
            }}
            disabled={!hasContent}
            className="flex shrink-0 flex-col items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium leading-tight text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cmdHeld && hasContent ? (
              <>
                <span className="flex items-center gap-1.5">
                  Send
                  <kbd className="rounded border border-white/30 bg-white/10 px-1 py-0.5 font-mono text-[10px] leading-none opacity-60">⌘</kbd>
                </span>
                <span className="-my-1 text-[9px] font-normal opacity-50">+</span>
                <span className="flex items-center gap-1.5">
                  Archive
                  <kbd className="rounded border border-white/30 bg-white/10 px-1 py-0.5 font-mono text-[10px] leading-none opacity-60">↵</kbd>
                </span>
              </>
            ) : (
              <span className="flex items-center gap-1.5">
                Send
                <kbd className="rounded border border-white/30 bg-white/10 px-1 py-0.5 font-mono text-[10px] leading-none opacity-60">↵</kbd>
              </span>
            )}
          </button>
        </div>
      </div>
    );
  }
);

ComposeBox.displayName = 'ComposeBox';
