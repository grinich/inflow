import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';

const REFETCH_INTERVAL = 30_000; // 30 seconds
const DEBOUNCE_MS = 150; // debounce rapid thread switches

export function useThread(conversationId: string | null) {
  const messages = useLiveQuery(
    async () => {
      if (!conversationId) return [];
      const all = await db.messages
        .where('[conversationId+createdAt]')
        .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
        .toArray();

      // Deduplicate: SSE events store messages with non-canonical IDs
      // (urn:li:fsd_message: / urn:li:fs_event:) while the Messenger API
      // uses urn:li:msg_message:. When both exist, drop the non-canonical one.
      const canonicalKeys = new Set<string>();
      for (const msg of all) {
        if (msg.id.startsWith('urn:li:msg_message:')) {
          canonicalKeys.add(`${msg.body}|${msg.senderUrn}`);
        }
      }
      if (canonicalKeys.size === 0) return all;
      return all.filter((msg) => {
        if (msg.id.startsWith('urn:li:msg_message:') || msg.id.startsWith('temp-')) return true;
        return !canonicalKeys.has(`${msg.body}|${msg.senderUrn}`);
      });
    },
    [conversationId],
    []
  );

  // Track the last fetched conversation to debounce only rapid re-switches,
  // not the initial navigation to a new conversation.
  const lastFetchedRef = useRef<string | null>(null);

  // Ask the background to fetch and store messages (initial + periodic re-fetch).
  // First switch to a conversation fires immediately; rapid A→B→C collapses via debounce.
  // useLiveQuery already renders cached messages instantly from IndexedDB.
  useEffect(() => {
    if (!conversationId) return;

    const isRapidSwitch = lastFetchedRef.current !== null && lastFetchedRef.current !== conversationId;

    const timeout = setTimeout(() => {
      lastFetchedRef.current = conversationId;
      sendBridgeMessage({ type: 'FETCH_MESSAGES', conversationId });
    }, isRapidSwitch ? DEBOUNCE_MS : 0);

    const interval = setInterval(() => {
      sendBridgeMessage({ type: 'FETCH_MESSAGES', conversationId });
    }, REFETCH_INTERVAL);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [conversationId]);

  return messages;
}
