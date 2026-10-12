import { useState, useEffect, useRef as useReactRef, useCallback, useMemo, forwardRef } from 'react';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import { searchEmoji, EMOJI_SHORTCODE_RE, type EmojiResult } from '@/lib/emoji-search';
import { EmojiAutocomplete } from './EmojiAutocomplete';
import { EmojiPicker } from './EmojiPicker';
import { useAutocomplete } from '@/hooks/useAutocomplete';
import { useReplySuggestions } from '@/hooks/useReplySuggestions';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import type { AiComposeApi } from '@/hooks/useAiCompose';
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

/** LinkedIn rejects oversized message attachments; guard before we upload. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB

/** LinkedIn caps member-to-member messages around 8,000 characters. The counter
 * turns amber past 90% and red past the limit (soft — we don't block the send). */
const MESSAGE_CHAR_LIMIT = 8000;

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
  /** AI Compose API (toggle + instruction + generate), shared with the thread. */
  ai?: AiComposeApi;
}

export const ComposeBox = forwardRef<HTMLTextAreaElement, ComposeBoxProps>(
  ({ conversationId, messages = [], participantNames = [], ai }, ref) => {
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
    const fileInputRef = useReactRef<HTMLInputElement | null>(null);
    const photoInputRef = useReactRef<HTMLInputElement | null>(null);
    // Tracks whether AI compose mode is on, for stale-closure send listeners.
    const aiModeRef = useReactRef(false);
    // A draft conversation whose recipient is not one of the user's connections
    // can only be reached by InMail: it carries a subject and spends a credit.
    // Held in a ref too, because the send listeners capture a stale closure.
    const inMailRef = useReactRef<{ to: string | null; subject: string }>({ to: null, subject: '' });
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    // Outbox actions (Save draft / Schedule) — only on the new-message flow,
    // where recipients are unambiguous (a draft-* conversation).
    const [outboxMenuOpen, setOutboxMenuOpen] = useState(false);
    const [scheduleWhen, setScheduleWhen] = useState('');
    const isDraftConv = conversationId.startsWith('draft-');

    const [inMailTo, setInMailTo] = useState<string | null>(null);
    const [subject, setSubject] = useState('');
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
    // Re-measure when the reused field switches to/holds the AI instruction.
    useEffect(() => { autoResize(); }, [ai?.enabled, ai?.instruction, autoResize]);

    // Stable object URLs for image previews (created once per file, revoked on removal)
    const prevUrls = useReactRef<Map<File, string>>(new Map());
    const previewUrls = useMemo(() => {
      const map = new Map<File, string>();
      for (const file of attachments) {
        // Reuse the URL of a file that's still attached — recreating it on every
        // attachments change would drop the old URL unrevoked, pinning the file
        // data in memory until the page closes.
        if (file.type.startsWith('image/')) map.set(file, prevUrls.current.get(file) ?? URL.createObjectURL(file));
      }
      return map;
    }, [attachments]);

    // Revoke old URLs when attachments change
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

    // Decide whether this draft can only go out as an InMail. We check the
    // recipients against the synced connection list rather than asking
    // LinkedIn, so it costs nothing and works offline.
    useEffect(() => {
      let cancelled = false;
      setInMailTo(null);
      setSubject('');
      if (!isDraftConv || !db) return;
      (async () => {
        try {
          const conv = await db.conversations.get(conversationId);
          const urns = conv?.participantUrns ?? [];
          if (!urns.length) return;
          const known = await db.connections.bulkGet(urns);
          // Any known connection means an ordinary message, not an InMail.
          if (!cancelled && !known.some(Boolean)) {
            setInMailTo(conv?.participantNames?.[0] || 'This person');
          }
        } catch {
          /* leave it as an ordinary message rather than guessing InMail */
        }
      })();
      return () => { cancelled = true; };
    }, [conversationId, isDraftConv]);

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
        const incoming: File[] = Array.isArray(detail)
          ? detail[0] instanceof File ? detail : detail.map((d: any) => d.file)
          : [];
        if (!incoming.length) return;

        // Guard file size here so every entry point (drop, paste, attach button)
        // is validated in one place before we persist/upload.
        const newFiles = incoming.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
        const rejected = incoming.length - newFiles.length;
        if (rejected > 0) {
          useUIStore.getState().showToast({
            message: `${rejected} file${rejected === 1 ? '' : 's'} skipped — over the 20 MB limit`,
          });
        }
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

    /** Insert an emoji character at the caret (used by the click-to-pick popover). */
    function insertEmojiChar(emoji: string) {
      const ta = textareaRef.current;
      const start = ta?.selectionStart ?? body.length;
      const end = ta?.selectionEnd ?? start;
      const newBody = body.slice(0, start) + emoji + body.slice(end);
      setBody(newBody);
      const pos = start + emoji.length;
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus();
          ta.setSelectionRange(pos, pos);
        }
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

    // `overrideText` sends that exact text (used by AI Compose's one-click
    // Approve) instead of the composer body, and leaves the composer state alone.
    async function handleSend(overrideText?: string) {
      const text = (overrideText ?? body).trim();
      const filesToSend = overrideText ? undefined : (attachments.length > 0 ? [...attachments] : undefined);
      if (!text && !filesToSend) return;

      // Read reply state directly from store to avoid stale closure
      // (the inflow:send event listener may hold an old handleSend reference)
      const currentReply = overrideText ? null : useUIStore.getState().replyingTo;

      if (!overrideText) {
        setBody('');
        setAttachments([]);
        useUIStore.getState().setReplyingTo(null);
        saveDraft(conversationId, '', []);
        document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
        // Reset textarea height
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        // Keep focus in the composer so the user can immediately type the next
        // message (iMessage-style rapid sends). Escape still exits to the list
        // for j/k navigation.
        const ta = textareaRef.current;
        if (ta) ta.focus();
      }

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

    /**
     * Save the current compose as a queued item — a deliberate draft, or a
     * scheduled send — instead of sending now. Works for both a new-message
     * draft conversation (creates a fresh thread on send) and a reply into an
     * existing thread (`conversationId` is carried so the send goes to that
     * thread). Drafts/scheduled live in the Inbox; the queue is not owned by the
     * MCP connector. Attachments aren't carried into the queue yet — those still
     * go out with an immediate send.
     */
    async function saveToOutbox(status: 'draft' | 'scheduled', scheduledAt?: number) {
      const text = body.trim();
      if (!text) return;
      const conv = await db.conversations.get(conversationId);
      if (!conv) {
        useUIStore.getState().showToast({ message: 'Conversation not found' });
        return;
      }
      const now = Date.now();
      await db.scheduledMessages.add({
        id: crypto.randomUUID(),
        recipientUrns: conv.participantUrns,
        recipientName: conv.participantNames.filter(Boolean).join(', ') || 'Unknown',
        // A reply carries the thread id; a new-message draft does not.
        ...(isDraftConv ? {} : { conversationId }),
        body: text,
        status,
        ...(scheduledAt ? { scheduledAt } : {}),
        createdAt: now,
        updatedAt: now,
      });
      // Clear the composer and its transient thread draft.
      setBody('');
      setAttachments([]);
      setOutboxMenuOpen(false);
      setScheduleWhen('');
      saveDraft(conversationId, '', []);
      const store = useUIStore.getState();
      if (isDraftConv) {
        try { await db.conversations.delete(conversationId); } catch {}
        store.setComposeNewActive(false);
      }
      // Surface where it landed — the Inbox Drafts / Scheduled tab.
      store.setActiveSection('inbox');
      store.setInboxTab(status === 'scheduled' ? 'scheduled' : 'drafts');
      store.showToast({ message: status === 'scheduled' ? 'Scheduled — find it in Scheduled' : 'Saved to Drafts' });
    }

    /**
     * Bring back the composed message after a failed draft-conversation send.
     * handleSend optimistically cleared the compose state and the persisted
     * draft row; unlike normal sends there is no failed-message record to
     * retry from, so without this the user's text and files are destroyed.
     */
    function restoreCompose(text: string, files?: File[]) {
      setBody(text);
      setAttachments(files ?? []);
      saveDraft(conversationId, text, files ?? []);
      document.dispatchEvent(new CustomEvent('inflow:draft-change', { detail: conversationId }));
    }

    async function handleDraftSend(text: string, files?: File[], archiveAfterSend = false) {
      const store = useUIStore.getState();

      try {
        // Get recipient URNs from the draft conversation in IndexedDB
        const draftConv = await db.conversations.get(conversationId);
        if (!draftConv) {
          restoreCompose(text, files);
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
          ...(inMailRef.current.to
            ? { inMail: { subject: inMailRef.current.subject.trim() } }
            : {}),
        });

        if (res.success && res.data?.conversationId) {
          const realConversationId = res.data.conversationId;
          if (archiveAfterSend) {
            await sendBridgeMessage({ type: 'ARCHIVE', conversationId: realConversationId }).catch(() => {});
          }

          // Carry the recipient's name/picture from the draft over to the real
          // conversation. Otherwise the outbound SSE echo seeds this conversation
          // with no participant data (the recipient's profile may have never been
          // synced), leaving it labeled "Unknown". Merge with any row the echo may
          // have already created so we don't clobber its lastMessage/category.
          const echoed = await db.conversations.get(realConversationId);
          await db.conversations.put({
            id: realConversationId,
            participantUrns: draftConv.participantUrns,
            participantNames: draftConv.participantNames,
            participantPictures: draftConv.participantPictures,
            lastMessage: echoed?.lastMessage || text,
            lastActivityAt: echoed?.lastActivityAt ?? Date.now(),
            read: echoed?.read ?? 1,
            archived: echoed?.archived ?? 0,
            category: echoed?.category || 'PRIMARY_INBOX',
            hasAttachments: echoed?.hasAttachments ?? (bridgeAttachments?.length ? 1 : 0),
            starred: echoed?.starred ?? 0,
          });

          // Clean up draft conversation
          await db.conversations.delete(conversationId).catch(() => {});
          await db.draftAttachments.delete(conversationId).catch(() => {});

          // Trigger sync to load the new conversation's message history
          sendBridgeMessage({ type: 'SYNC_CONVERSATIONS' }).catch(() => {});
          // Navigate to the real conversation
          setTimeout(() => {
            store.openThread(realConversationId, 0);
          }, 500);
        } else {
          restoreCompose(text, files);
          store.showToast({ message: res.error || 'Failed to send message' });
        }
      } catch {
        restoreCompose(text, files);
        store.showToast({ message: 'Failed to send message' });
      }
    }

    // Listen for send (Enter) and send+archive (Cmd+Enter) from keyboard manager
    useEffect(() => {
      function onSend() {
        // In AI mode the field holds an instruction, not a message — Enter
        // generates instead (handled on the textarea). Never send here.
        if (aiModeRef.current) return;
        handleSend();
      }
      // AI Compose: Approve sends the generated draft directly (one click). The
      // user's Approve click is the send confirmation — nothing sends without it.
      function onAiSend(e: Event) {
        const detail = (e as CustomEvent).detail as { conversationId?: string; text?: string } | undefined;
        if (!detail || detail.conversationId !== conversationId || !detail.text) return;
        void handleSend(detail.text);
      }
      document.addEventListener('inflow:ai-compose-send', onAiSend);
      function onSendAndArchive() {
        if (aiModeRef.current) return;
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
        if (conversationId.startsWith('draft-')) {
          void handleDraftSend(text, filesToSend, true);
          return;
        }
        // Atomic send+archive — archives first optimistically, then sends in background
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
        document.removeEventListener('inflow:ai-compose-send', onAiSend);
        document.removeEventListener('inflow:send', onSend);
        document.removeEventListener('inflow:send-and-archive', onSendAndArchive);
      };
    }, [conversationId, body, attachments]);

    const hasContent = !!(body.trim() || attachments.length > 0);

    // AI compose mode: the reply field is reused as the instruction box, and the
    // Send arrow becomes Generate. A ref lets the (stale-closure) send listeners
    // bail so a stray Enter never sends a leftover message while instructing.
    inMailRef.current = { to: inMailTo, subject };
    const aiMode = !!ai?.enabled;
    const displayValue = aiMode ? (ai?.instruction ?? '') : body;
    aiModeRef.current = aiMode;

    return (
      <div className="border-t border-edge p-3">
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

        {/* AI reply suggestion chips (not while instructing in AI compose mode) */}
        {!aiMode && body.length === 0 && (replySuggestions.suggestions.length > 0 || replySuggestions.isLoading) && (
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

        {/* Hidden file pickers (triggered by the toolbar buttons below) */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-hidden="true"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) {
              document.dispatchEvent(new CustomEvent('inflow:attach-files', { detail: files }));
            }
            // Reset so picking the same file again re-fires change.
            e.target.value = '';
          }}
        />
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-hidden="true"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) {
              document.dispatchEvent(new CustomEvent('inflow:attach-files', { detail: files }));
            }
            e.target.value = '';
          }}
        />

        {/* InMail: the recipient is not a connection, so this goes out as a
            Premium InMail with a subject and costs one credit. Say so plainly
            before they send rather than after. */}
        {inMailTo && (
          <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-2">
            <div className="flex items-center gap-2 px-0.5">
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                InMail
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
                {inMailTo} is not a connection. Sending uses one InMail credit.
              </span>
            </div>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject (optional)"
              aria-label="InMail subject"
              maxLength={200}
              className="mt-1.5 w-full rounded-lg bg-surface px-2.5 py-1.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
            />
          </div>
        )}

        {/* Unified composer field: attachments, textarea, and a slim action row
            all share one rounded surface (iMessage / Slack style). */}
        <div className="rounded-2xl bg-surface-input px-2.5 pb-1.5 pt-2 ring-1 ring-inset ring-ring-muted transition-colors focus-within:ring-blue-500/50">
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-0.5">
              {attachments.map((file, i) =>
                file.type.startsWith('image/') ? (
                  <span
                    key={`${file.name}-${i}`}
                    className="group relative inline-block overflow-hidden rounded-lg ring-1 ring-ring-muted"
                  >
                    <img
                      src={previewUrls.get(file)}
                      alt={file.name}
                      className="h-12 w-12 cursor-zoom-in object-cover"
                      onClick={() => {
                        const url = previewUrls.get(file);
                        if (url) useUIStore.getState().openLightbox(url);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      aria-label={`Remove ${file.name}`}
                      className="absolute right-0.5 top-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-black/60 text-[10px] leading-none text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <span
                    key={`${file.name}-${i}`}
                    className="inline-flex items-center gap-1 rounded-lg bg-surface-raised px-2 py-1 text-xs text-fg-muted ring-1 ring-ring-muted"
                  >
                    <span>{fileIcon(file)}</span>
                    <span className="max-w-[140px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      aria-label={`Remove ${file.name}`}
                      className="ml-0.5 cursor-pointer text-fg-faint hover:text-fg"
                    >
                      ×
                    </button>
                  </span>
                )
              )}
            </div>
          )}

          {/* Textarea + overlays (ghost autocomplete, emoji popup) */}
          <div className="relative flex items-end">
            {!aiMode && autocomplete.suggestion && (
              <div
                className="pointer-events-none absolute inset-0 overflow-hidden px-1.5 py-1 text-sm"
                style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
              >
                <span style={{ visibility: 'hidden' }}>{body}</span>
                <span className="text-zinc-500">{autocomplete.suggestion}</span>
              </div>
            )}
            <textarea
              ref={setRefs}
              value={displayValue}
              onChange={(e) => {
                const val = e.target.value;
                // AI mode: the field is the instruction box — no message state,
                // no emoji shortcodes, no autocomplete.
                if (aiMode) {
                  ai?.setInstruction(val);
                  autoResize();
                  return;
                }
                setBody(val);
                autoResize();
                // Track whether cursor is at the end of the text
                const pos = e.target.selectionStart ?? val.length;
                setCursorAtEnd(pos === val.length);
                // Detect emoji shortcode: `:` followed by valid chars before cursor
                const before = val.slice(0, pos);
                const match = before.match(EMOJI_SHORTCODE_RE);
                if (match) {
                  setEmojiQuery(match[1]);
                  setEmojiIndex(0);
                } else {
                  setEmojiQuery(null);
                }
              }}
              onSelect={(e) => {
                // Keep cursorAtEnd fresh on caret movement without a text change
                // (arrow keys, click) so autocomplete gating doesn't go stale.
                const ta = e.currentTarget;
                setCursorAtEnd((ta.selectionStart ?? ta.value.length) === ta.value.length);
              }}
              onFocus={() => setComposeActive(true)}
              onBlur={() => { setComposeActive(false); setEmojiQuery(null); }}
              placeholder={aiMode ? 'Describe the message the AI should write…' : 'Reply...'}
              aria-label={aiMode ? 'Describe the message for the AI to write' : undefined}
              rows={1}
              data-compose-input=""
              data-emoji-open={emojiOpen ? '' : undefined}
              data-autocomplete-open={autocomplete.isOpen || undefined}
              className="max-h-40 w-full resize-none bg-transparent px-1.5 py-1 text-sm text-fg placeholder-fg-faint outline-none"
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files || []);
                if (files.length) {
                  e.preventDefault();
                  document.dispatchEvent(new CustomEvent('inflow:attach-files', { detail: files }));
                }
              }}
              onKeyDown={(e) => {
                // AI mode: Enter generates from the instruction (Shift+Enter =
                // newline). Nothing else in the composer's key handling applies.
                if (aiMode) {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    if ((ai?.instruction ?? '').trim() && ai?.status !== 'generating') void ai?.generate();
                  }
                  return;
                }
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

          {/* Slim action row: attach / photo / emoji on the left, send on the right */}
          <div className="mt-0.5 flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={aiMode}
              title="Attach a file"
              aria-label="Attach a file"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:pointer-events-none disabled:opacity-40"
            >
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={aiMode}
              title="Attach a photo"
              aria-label="Attach a photo"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:pointer-events-none disabled:opacity-40"
            >
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </button>

            {/* Emoji picker */}
            <div className="relative shrink-0">
              {emojiPickerOpen && (
                <EmojiPicker
                  onSelect={insertEmojiChar}
                  onClose={() => setEmojiPickerOpen(false)}
                />
              )}
              <button
                type="button"
                onClick={() => setEmojiPickerOpen((v) => !v)}
                disabled={aiMode}
                title="Emoji"
                aria-label="Emoji"
                aria-expanded={emojiPickerOpen}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40 ${emojiPickerOpen ? 'text-fg-secondary' : 'text-fg-muted hover:text-fg-secondary'}`}
              >
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>
            </div>

            {/* AI compose toggle. Active when a provider is available; otherwise
                greyed with a hint that links to setup — or hidden entirely if the
                user turned that on in Settings (for people who don't use AI). */}
            {ai && (ai.available ? (
              <button
                type="button"
                onClick={() => ai.setEnabled(!ai.enabled)}
                title={ai.enabled ? 'Turn off AI compose' : 'AI compose — describe a message and let AI draft it'}
                aria-label="AI compose"
                aria-pressed={ai.enabled}
                className={`flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors ${
                  ai.enabled
                    ? 'bg-blue-500/15 text-blue-700 ring-1 ring-inset ring-blue-500/30 dark:text-blue-300'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg-secondary'
                }`}
              >
                <SparkleIcon className="h-[18px] w-[18px]" />
                <span className="hidden sm:inline">AI</span>
              </button>
            ) : !ai.hideWhenUnavailable ? (
              <span className="group/aineed relative shrink-0">
                <button
                  type="button"
                  onClick={() => useUIStore.getState().openSettings('ai')}
                  aria-label="AI compose — set up AI to use it"
                  className="flex h-8 shrink-0 cursor-help items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg-faint opacity-60 transition-opacity hover:bg-surface-hover hover:opacity-100"
                >
                  <SparkleIcon className="h-[18px] w-[18px]" />
                  <span className="hidden sm:inline">AI</span>
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-lg bg-surface-raised px-2.5 py-1.5 text-[11px] leading-snug text-fg-secondary opacity-0 shadow-lg ring-1 ring-inset ring-edge transition-opacity group-hover/aineed:opacity-100"
                >
                  AI compose needs a provider — add a key or connect the companion.
                  <span className="mt-0.5 block font-medium text-blue-500 dark:text-blue-300">Open AI settings →</span>
                </span>
              </span>
            ) : null)}

            <div className="flex-1" />

            {/* Character counter — appears once you're typing a message (not an
                AI instruction). Amber near LinkedIn's ~8,000 cap, red past it. */}
            {!aiMode && body.length > 0 && (
              <span
                className={`self-center px-1.5 text-[11px] tabular-nums ${
                  body.length > MESSAGE_CHAR_LIMIT
                    ? 'text-red-500'
                    : body.length > MESSAGE_CHAR_LIMIT * 0.9
                      ? 'text-amber-500'
                      : 'text-fg-faint'
                }`}
                title={`${body.length.toLocaleString()} of ${MESSAGE_CHAR_LIMIT.toLocaleString()} characters`}
              >
                {body.length > MESSAGE_CHAR_LIMIT * 0.9
                  ? `${body.length.toLocaleString()} / ${MESSAGE_CHAR_LIMIT.toLocaleString()}`
                  : body.length.toLocaleString()}
              </span>
            )}

            {/* Save-as-draft / schedule — hidden while instructing in AI mode */}
            {!aiMode && (
            <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setOutboxMenuOpen((v) => !v)}
                  disabled={!body.trim()}
                  title="Save as draft or schedule for later"
                  aria-label="Save as draft or schedule"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
                {outboxMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOutboxMenuOpen(false)} />
                    <div className="absolute bottom-full right-0 z-50 mb-1.5 w-60 rounded-xl border border-edge bg-surface-raised p-1.5 shadow-lg">
                      <button
                        type="button"
                        onClick={() => saveToOutbox('draft')}
                        className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong"
                      >
                        Save as draft
                      </button>
                      <div className="mt-1 border-t border-edge pt-1.5">
                        <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Schedule for later</p>
                        <div className="px-1.5">
                          <input
                            type="datetime-local"
                            value={scheduleWhen}
                            onChange={(e) => setScheduleWhen(e.target.value)}
                            className="w-full rounded-md bg-surface-input px-2 py-1 text-xs text-fg-strong ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
                          />
                          <button
                            type="button"
                            disabled={!scheduleWhen}
                            onClick={() => {
                              const at = new Date(scheduleWhen).getTime();
                              if (Number.isFinite(at)) void saveToOutbox('scheduled', at);
                            }}
                            className="mt-1.5 w-full rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300"
                          >
                            Schedule
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* AI mode: the Send arrow becomes Generate (runs the instruction). */}
            {aiMode ? (
              <button
                type="button"
                onClick={() => void ai?.generate()}
                disabled={!(ai?.instruction ?? '').trim() || ai?.status === 'generating'}
                aria-label="Generate a draft"
                title="Generate a draft from your instruction"
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-blue-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SparkleIcon className="h-4 w-4" />
                {ai?.status === 'generating' ? 'Writing…' : 'Generate'}
              </button>
            ) : (
            /* Send — hold ⌘ to send and archive (hint lives in the tooltip) */
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
              aria-label={cmdHeld && hasContent ? 'Send and archive' : 'Send'}
              title={cmdHeld && hasContent ? 'Send and archive (⌘↵)' : 'Send (↵) — hold ⌘ to send and archive'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full btn-send transition-colors disabled:cursor-not-allowed"
            >
              {cmdHeld && hasContent ? (
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="5" rx="1" />
                  <path d="M4 9v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
                  <path d="M10 13h4" />
                </svg>
              ) : (
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              )}
            </button>
            )}
          </div>
        </div>
      </div>
    );
  }
);

ComposeBox.displayName = 'ComposeBox';
