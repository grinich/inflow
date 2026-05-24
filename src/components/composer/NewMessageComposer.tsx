import { useState, useRef, useEffect, useCallback } from 'react';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore } from '@/store/ui-store';
import { db } from '@/db/database';
import { useCachedImage } from '@/hooks/useCachedImage';
import type { Conversation } from '@/types/conversation';

function makeDraftConversationId(profileUrns: string[]): string {
  const ids = profileUrns
    .map((urn) => urn.split(':').pop()!)
    .sort()
    .join('+');
  return `draft-${ids}`;
}

interface TypeaheadResult {
  name: string;
  headline: string;
  pictureUrl: string;
  profileUrn: string;
}

interface SelectedRecipient {
  name: string;
  profileUrn: string;
  pictureUrl: string;
}

interface NewMessageComposerProps {
  draftConversation?: Conversation;
  composeRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function NewMessageComposer({ draftConversation, composeRef }: NewMessageComposerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TypeaheadResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [draftConvId, setDraftConvId] = useState<string | null>(null);

  // Initialize recipients from draftConversation prop
  const [recipients, setRecipients] = useState<SelectedRecipient[]>(() => {
    if (draftConversation?.draft === 1) {
      return draftConversation.participantUrns.map((urn, i) => ({
        name: draftConversation.participantNames[i] || '',
        profileUrn: urn,
        pictureUrl: draftConversation.participantPictures[i] || '',
      }));
    }
    return [];
  });

  // Track the draft conversation ID from the prop
  useEffect(() => {
    if (draftConversation?.draft === 1) {
      setDraftConvId(draftConversation.id);
    }
  }, [draftConversation]);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestQueryRef = useRef('');
  const selfUrnRef = useRef<string | null>(null);
  const recipientsRef = useRef(recipients);
  recipientsRef.current = recipients;

  useEffect(() => {
    inputRef.current?.focus();
    // Fetch own profile URN so we can exclude self from search results
    sendBridgeMessage({ type: 'CHECK_AUTH' }).then((res) => {
      if (res.success && res.data?.memberUrn) {
        selfUrnRef.current = res.data.memberUrn;
      }
    }).catch(() => {});
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim().toLowerCase();
    latestQueryRef.current = trimmed;

    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      // Search local profiles and conversations for matching names
      const [profiles, conversations] = await Promise.all([
        db.profiles.toArray(),
        db.conversations.toArray(),
      ]);

      const seen = new Set<string>();
      if (selfUrnRef.current) seen.add(selfUrnRef.current);
      // Exclude already-selected recipients
      for (const r of recipientsRef.current) seen.add(r.profileUrn);
      const matches: TypeaheadResult[] = [];

      // Search profiles first — they have richer data
      for (const p of profiles) {
        const name = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim();
        if (!name || name === 'LinkedIn Member' || !name.toLowerCase().includes(trimmed)) continue;
        const profileUrn = p.urn;
        if (seen.has(profileUrn)) continue;
        seen.add(profileUrn);
        matches.push({
          name,
          headline: p.occupation || '',
          pictureUrl: p.pictureUrl || '',
          profileUrn,
        });
        if (matches.length >= 20) break;
      }

      // Also search conversation participants for names not in profiles
      if (matches.length < 20) {
        for (const c of conversations) {
          if (c.draft === 1) continue; // skip draft conversations
          for (let i = 0; i < c.participantNames.length; i++) {
            const pName = c.participantNames[i];
            const pUrn = c.participantUrns[i];
            if (!pName || pName === 'LinkedIn Member' || !pUrn || seen.has(pUrn)) continue;
            if (!pName.toLowerCase().includes(trimmed)) continue;
            seen.add(pUrn);
            matches.push({
              name: pName,
              headline: '',
              pictureUrl: c.participantPictures?.[i] || '',
              profileUrn: pUrn,
            });
            if (matches.length >= 20) break;
          }
          if (matches.length >= 20) break;
        }
      }

      // Show local results immediately
      if (latestQueryRef.current !== trimmed) return;
      setResults(matches);
      setSelectedIdx(0);

      // Fire LinkedIn API search in parallel (skip for very short queries)
      if (trimmed.length >= 2) {
        sendBridgeMessage({ type: 'TYPEAHEAD_SEARCH', query: trimmed })
          .then((res) => {
            // Discard if query has changed since we fired
            if (latestQueryRef.current !== trimmed) return;
            if (!res.success || !Array.isArray(res.data)) return;

            setResults((prev) => {
              const existingUrns = new Set(prev.map((r) => r.profileUrn));
              const selectedUrns = new Set(recipientsRef.current.map((r) => r.profileUrn));
              const newResults = (res.data as TypeaheadResult[]).filter(
                (r) => !existingUrns.has(r.profileUrn) && !selectedUrns.has(r.profileUrn) && r.name !== 'LinkedIn Member' && r.profileUrn !== selfUrnRef.current
              );
              if (newResults.length === 0) return prev;
              return [...prev, ...newResults].slice(0, 20);
            });
          })
          .catch(() => {
            // silently fail — local results are already shown
          });
      }
    } catch {
      // silently fail
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleSelectRecipient = async (result: TypeaheadResult) => {
    const newRecipient: SelectedRecipient = {
      name: result.name,
      profileUrn: result.profileUrn,
      pictureUrl: result.pictureUrl,
    };
    const updated = [...recipients, newRecipient];
    setRecipients(updated);
    setQuery('');
    setResults([]);

    // Clean up old draft if recipients changed
    if (draftConvId) {
      await cleanupDraft(draftConvId);
    }

    // Create/update draft conversation with all recipients
    const convId = makeDraftConversationId(updated.map((r) => r.profileUrn));
    const draftConv: Conversation = {
      id: convId,
      participantUrns: updated.map((r) => r.profileUrn),
      participantNames: updated.map((r) => r.name),
      participantPictures: updated.map((r) => r.pictureUrl),
      lastMessage: '',
      lastActivityAt: Date.now(),
      read: 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
      draft: 1,
    };
    await db.conversations.put(draftConv);
    setDraftConvId(convId);

    // Switch to focused tab and select this draft conversation
    const store = useUIStore.getState();
    if (store.inboxTab !== 'focused') {
      store.setInboxTab('focused');
    }
    store.setSelectedConversationId(convId);

    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRemoveRecipient = async (index: number) => {
    const updated = recipients.filter((_, i) => i !== index);
    setRecipients(updated);

    // Clean up old draft
    if (draftConvId) {
      await cleanupDraft(draftConvId);
    }

    if (updated.length === 0) {
      setDraftConvId(null);
    } else {
      // Recreate draft with remaining recipients
      const convId = makeDraftConversationId(updated.map((r) => r.profileUrn));
      const draftConv: Conversation = {
        id: convId,
        participantUrns: updated.map((r) => r.profileUrn),
        participantNames: updated.map((r) => r.name),
        participantPictures: updated.map((r) => r.pictureUrl),
        lastMessage: '',
        lastActivityAt: Date.now(),
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
        draft: 1,
      };
      await db.conversations.put(draftConv);
      setDraftConvId(convId);
      useUIStore.getState().setSelectedConversationId(convId);
    }

    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cleanupDraft = async (convId: string) => {
    try { await db.conversations.delete(convId); } catch {}
    try { await db.draftAttachments.delete(convId); } catch {}
  };

  const handleTransitionToThread = async () => {
    if (!draftConvId || recipients.length === 0) return;
    const store = useUIStore.getState();

    // Check if there's an existing conversation with these exact participants
    const recipientUrnSet = new Set(recipients.map((r) => r.profileUrn));
    const allConversations = await db.conversations.toArray();

    let existingConv: Conversation | null = null;
    for (const conv of allConversations) {
      if (conv.draft === 1) continue;
      // Get participant URNs excluding self
      const otherParticipants = conv.participantUrns.filter(
        (urn) => urn !== selfUrnRef.current
      );
      if (otherParticipants.length !== recipientUrnSet.size) continue;
      if (otherParticipants.every((urn) => recipientUrnSet.has(urn))) {
        existingConv = conv;
        break;
      }
    }

    if (existingConv) {
      // Found existing conversation — clean up draft and navigate to it
      await cleanupDraft(draftConvId);
      store.setComposeNewActive(false);
      store.setSelectedConversationId(existingConv.id);
    } else {
      // No existing conversation — keep draft, user will compose from scratch
      store.setComposeNewActive(false);
      store.setSelectedConversationId(draftConvId);
    }

    // Focus the compose textarea after ThreadView mounts
    setTimeout(() => composeRef?.current?.focus(), 50);
  };

  const handleDiscard = async () => {
    if (draftConvId) {
      await cleanupDraft(draftConvId);
    }
    const store = useUIStore.getState();
    store.setSelectedConversationId(null);
    store.setComposeNewActive(false);
  };

  const handleClose = async () => {
    if (draftConvId) {
      await cleanupDraft(draftConvId);
    }
    const store = useUIStore.getState();
    // Clear selection so auto-select picks the next real conversation
    store.setSelectedConversationId(null);
    store.setComposeNewActive(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 className="text-sm font-semibold text-fg-strong">New message</h2>
        {draftConvId ? (
          <button
            onClick={handleDiscard}
            className="cursor-pointer text-xs text-fg-muted hover:text-red-500"
          >
            Discard
          </button>
        ) : (
          <button
            onClick={handleClose}
            className="cursor-pointer text-fg-muted hover:text-fg-strong"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* To field */}
      <div className="border-b border-edge px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-fg-muted">To:</span>
          {recipients.map((r, i) => (
            <div key={r.profileUrn} className="flex items-center gap-1.5 rounded-full bg-surface-raised px-2.5 py-1">
              <span className="text-sm text-fg-strong">{r.name}</span>
              <button
                onClick={() => handleRemoveRecipient(i)}
                className="cursor-pointer text-fg-muted hover:text-fg-strong"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && recipients.length > 0) {
                // Tab → transition to thread view and focus compose textbox
                e.preventDefault();
                setQuery('');
                setResults([]);
                handleTransitionToThread();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && results[selectedIdx]) {
                e.preventDefault();
                handleSelectRecipient(results[selectedIdx]);
              } else if (e.key === 'Enter' && results.length === 0 && recipients.length > 0) {
                e.preventDefault();
                handleTransitionToThread();
              } else if (e.key === 'Backspace' && !query && recipients.length > 0) {
                e.preventDefault();
                handleRemoveRecipient(recipients.length - 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
              }
            }}
            placeholder={recipients.length === 0 ? 'Search for a person...' : 'Add another or press Tab to compose...'}
            className="min-w-[80px] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
          />
        </div>

        {/* Typeahead results */}
        {results.length > 0 && (
          <div className="mt-2 max-h-96 overflow-y-auto rounded-lg border border-edge bg-surface-raised py-1">
            {results.map((r, i) => (
              <TypeaheadRow
                key={r.profileUrn}
                result={r}
                selected={i === selectedIdx}
                onSelect={() => handleSelectRecipient(r)}
                onMouseEnter={() => setSelectedIdx(i)}
              />
            ))}
          </div>
        )}
        {searching && !results.length && query.trim().length >= 2 && (
          <div className="mt-2 py-2 text-center text-xs text-fg-faint">Searching...</div>
        )}
      </div>

      {/* Placeholder area */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-3">
        {recipients.length > 0 ? (
          <p className="text-sm text-fg-faint">Press Tab to start composing</p>
        ) : (
          <p className="text-sm text-fg-faint">Search for a person to start a conversation</p>
        )}
      </div>
    </div>
  );
}

function TypeaheadRow({
  result,
  selected,
  onSelect,
  onMouseEnter,
}: {
  result: TypeaheadResult;
  selected: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
}) {
  const avatarUrl = useCachedImage(result.pictureUrl);
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <button
      ref={rowRef}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors ${
        selected ? 'bg-surface-hover' : ''
      }`}
    >
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-muted">
        {avatarUrl ? (
          <img src={avatarUrl} alt={result.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-medium text-fg-secondary">
            {result.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg-strong">{result.name}</p>
        {result.headline && (
          <p className="truncate text-xs text-fg-muted">{result.headline}</p>
        )}
      </div>
    </button>
  );
}
