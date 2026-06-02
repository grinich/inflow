import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';

const DEBOUNCE_MS = 150; // debounce rapid thread switches

export function useThread(conversationId: string | null, mergedIds?: string[]) {
  const messages = useLiveQuery(
    async () => {
      if (!conversationId || !db) return [];
      const allIds = [conversationId, ...(mergedIds || [])];
      const chunks = await Promise.all(
        allIds.map((id) =>
          db.messages
            .where('[conversationId+createdAt]')
            .between([id, Dexie.minKey], [id, Dexie.maxKey])
            .toArray()
        )
      );
      const all = chunks.flat();

      // Deduplicate: SSE events store messages with non-canonical IDs
      // (urn:li:fsd_message: / urn:li:fs_event:) while the Messenger API
      // uses urn:li:msg_message:. When both exist, drop the non-canonical one.
      const canonicalKeys = new Set<string>();
      for (const msg of all) {
        if (msg.id.startsWith('urn:li:msg_message:')) {
          canonicalKeys.add(`${msg.body}|${msg.senderUrn}|${msg.createdAt}`);
        }
      }
      if (canonicalKeys.size === 0) return all.sort((a, b) => a.createdAt - b.createdAt);
      return all.filter((msg) => {
        if (msg.id.startsWith('urn:li:msg_message:') || msg.id.startsWith('temp-')) return true;
        return !canonicalKeys.has(`${msg.body}|${msg.senderUrn}|${msg.createdAt}`);
      }).sort((a, b) => a.createdAt - b.createdAt);
    },
    [conversationId, mergedIds?.join(',')],
    []
  );

  // Track the last fetched conversation to debounce only rapid re-switches,
  // not the initial navigation to a new conversation.
  const lastFetchedRef = useRef<string | null>(null);

  // Ask the background to fetch and store messages on initial thread open.
  // First switch fires immediately; rapid A→B→C collapses via debounce.
  // No periodic polling — SSE handles realtime updates while connected.
  // useLiveQuery already renders cached messages instantly from IndexedDB.
  useEffect(() => {
    if (!conversationId) return;

    const isRapidSwitch = lastFetchedRef.current !== null && lastFetchedRef.current !== conversationId;

    const timeout = setTimeout(() => {
      lastFetchedRef.current = conversationId;
      sendBridgeMessage({ type: 'FETCH_MESSAGES', conversationId });
      // Also fetch messages for merged conversations
      if (mergedIds) {
        for (const id of mergedIds) {
          sendBridgeMessage({ type: 'FETCH_MESSAGES', conversationId: id });
        }
      }
    }, isRapidSwitch ? DEBOUNCE_MS : 0);

    return () => {
      clearTimeout(timeout);
    };
  }, [conversationId, mergedIds?.join(',')]);

  // Re-fetch when tab becomes visible again (catches messages missed while backgrounded)
  useEffect(() => {
    if (!conversationId) return;
    function onVisible() {
      if (document.visibilityState === 'visible') {
        sendBridgeMessage({ type: 'FETCH_MESSAGES', conversationId: conversationId! });
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [conversationId]);

  return messages;
}
