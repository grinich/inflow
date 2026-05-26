import { getSession, getMemberUrn } from './auth/session';
import { linkedInVariables, raw } from './api/encode';
import { voyagerFetch } from './api/client';
import { normalizeConversations } from '@/lib/voyager-normalizer';
import { db } from '@/db/database';

export async function runDiagnosticSync(): Promise<string> {
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);
  const ts = () => new Date().toISOString();

  log(`=== INFLOW DIAGNOSTIC SYNC REPORT ===`);
  log(`Time: ${ts()}`);
  log('');

  // 1. Auth check
  try {
    const session = await getSession();
    const memberUrn = await getMemberUrn();
    log(`[AUTH] OK — memberUrn: ${memberUrn}`);
    log(`[AUTH] session keys: ${Object.keys(session || {}).join(', ')}`);
  } catch (err) {
    log(`[AUTH] FAILED: ${err}`);
    log('--- Cannot proceed without auth ---');
    return lines.join('\n');
  }

  const memberUrn = await getMemberUrn();

  // 2. Test default query (no category — should return focused inbox)
  log('');
  log('--- Query 1: Default (no category filter) ---');
  try {
    const variables = linkedInVariables({ mailboxUrn: memberUrn, count: 5, start: 0 });
    const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=${variables}`;
    log(`[URL] ${path}`);
    const res = await voyagerFetch(path);
    log(`[HTTP] ${res.status} ${res.statusText}`);
    if (res.ok) {
      const json = await res.json();
      const included = json.included || [];
      const convs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Conversation');
      const msgs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Message');
      const parts = included.filter((e: any) => e.$type === 'com.linkedin.messenger.MessagingParticipant');
      log(`[DATA] included.length=${included.length}, conversations=${convs.length}, messages=${msgs.length}, participants=${parts.length}`);
      log(`[DATA] $types: ${JSON.stringify([...new Set(included.map((e: any) => e.$type))])}`);
      if (convs.length > 0) {
        const c = convs[0];
        log(`[SAMPLE CONV] entityUrn=${c.entityUrn}`);
        log(`[SAMPLE CONV] categories=${JSON.stringify(c.categories)}, lastActivityAt=${c.lastActivityAt}, unreadCount=${c.unreadCount}`);
        log(`[SAMPLE CONV] keys: ${Object.keys(c).join(', ')}`);
        // Normalize to check
        const norm = normalizeConversations(json, memberUrn);
        log(`[NORMALIZED] conversations=${norm.conversations.length}, profiles=${norm.profiles.length}`);
        if (norm.conversations.length > 0) {
          const nc = norm.conversations[0];
          log(`[NORM SAMPLE] id=${nc.id}, category=${nc.category}, archived=${nc.archived}, read=${nc.read}, names=${nc.participantNames.join(', ')}`);
        }
      } else {
        log(`[DATA] No conversations in response!`);
        // Log first 3 entities for debugging
        for (let i = 0; i < Math.min(3, included.length); i++) {
          log(`[ENTITY ${i}] $type=${included[i].$type}, entityUrn=${included[i].entityUrn}`);
        }
      }
    } else {
      const body = await res.text().catch(() => '');
      log(`[ERROR BODY] ${body.substring(0, 500)}`);
    }
  } catch (err) {
    log(`[FAILED] ${err}`);
  }

  // 3. Test PRIMARY_INBOX category query
  log('');
  log('--- Query 2: PRIMARY_INBOX category filter ---');
  try {
    const variables = linkedInVariables({
      mailboxUrn: memberUrn,
      count: 5,
      start: 0,
      categories: raw('List(PRIMARY_INBOX)'),
    });
    const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.737b27144cf922499202658a5345016f&variables=${variables}`;
    log(`[URL] ${path}`);
    const res = await voyagerFetch(path);
    log(`[HTTP] ${res.status} ${res.statusText}`);
    if (res.ok) {
      const json = await res.json();
      const included = json.included || [];
      const convs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Conversation');
      log(`[DATA] included.length=${included.length}, conversations=${convs.length}`);
      if (convs.length > 0) {
        log(`[SAMPLE CONV] categories=${JSON.stringify(convs[0].categories)}`);
      }
    } else {
      const body = await res.text().catch(() => '');
      log(`[ERROR BODY] ${body.substring(0, 500)}`);
    }
  } catch (err) {
    log(`[FAILED] ${err}`);
  }

  // 4. Test SECONDARY_INBOX (Other)
  log('');
  log('--- Query 3: SECONDARY_INBOX (Other) ---');
  try {
    const variables = linkedInVariables({
      mailboxUrn: memberUrn,
      count: 5,
      start: 0,
      categories: raw('List(SECONDARY_INBOX)'),
    });
    const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.737b27144cf922499202658a5345016f&variables=${variables}`;
    log(`[URL] ${path}`);
    const res = await voyagerFetch(path);
    log(`[HTTP] ${res.status} ${res.statusText}`);
    if (res.ok) {
      const json = await res.json();
      const included = json.included || [];
      const convs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Conversation');
      log(`[DATA] included.length=${included.length}, conversations=${convs.length}`);
    } else {
      const body = await res.text().catch(() => '');
      log(`[ERROR BODY] ${body.substring(0, 500)}`);
    }
  } catch (err) {
    log(`[FAILED] ${err}`);
  }

  // 5. Test ARCHIVE
  log('');
  log('--- Query 4: ARCHIVE ---');
  try {
    const variables = linkedInVariables({
      mailboxUrn: memberUrn,
      count: 5,
      start: 0,
      categories: raw('List(ARCHIVE)'),
    });
    const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.737b27144cf922499202658a5345016f&variables=${variables}`;
    log(`[URL] ${path}`);
    const res = await voyagerFetch(path);
    log(`[HTTP] ${res.status} ${res.statusText}`);
    if (res.ok) {
      const json = await res.json();
      const included = json.included || [];
      const convs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Conversation');
      log(`[DATA] included.length=${included.length}, conversations=${convs.length}`);
    } else {
      const body = await res.text().catch(() => '');
      log(`[ERROR BODY] ${body.substring(0, 500)}`);
    }
  } catch (err) {
    log(`[FAILED] ${err}`);
  }

  // 6. Message structure inspection — paginate through conversations to find attachments
  log('');
  log('--- Query 5: Scanning for messages with attachments ---');
  try {
    const MAX_CONVS = 80;
    const RICH_TARGET = 3; // stop after finding this many rich conversations
    let scanned = 0;
    let richFound = 0;
    let page = 0;

    outer:
    while (scanned < MAX_CONVS && richFound < RICH_TARGET) {
      // Fetch a page of conversations from the API
      const convVars = linkedInVariables({ mailboxUrn: memberUrn, count: 20, start: page * 20 });
      const convPath = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=${convVars}`;
      const convRes = await voyagerFetch(convPath);
      if (!convRes.ok) {
        log(`[SCAN] Conversation page ${page} failed: HTTP ${convRes.status}`);
        break;
      }
      const convJson = await convRes.json();
      const convNorm = normalizeConversations(convJson, memberUrn);
      if (convNorm.conversations.length === 0) {
        log(`[SCAN] No more conversations at page ${page}`);
        break;
      }
      log(`[SCAN] Page ${page}: ${convNorm.conversations.length} conversations`);

      for (const conv of convNorm.conversations) {
        if (richFound >= RICH_TARGET) break outer;
        scanned++;
        try {
          const conversationUrn = `urn:li:msg_conversation:(${memberUrn},${conv.id})`;
          const msgVars = `(conversationUrn:${conversationUrn.replace(/:/g, '%3A').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/,/g, '%2C').replace(/=/g, '%3D')})`;
          const msgPath = `/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.5846eeb71c981f11e0134cb6626cc314&variables=${msgVars}`;
          const msgRes = await voyagerFetch(msgPath);
          if (!msgRes.ok) continue;
          const msgJson = await msgRes.json();
          const included = msgJson.included || [];
          const msgEntities = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Message');
          const allTypes = [...new Set<string>(included.map((e: any) => e.$type))];

          const richMsgs = msgEntities.filter((m: any) => m.renderContent?.length > 0);
          const nonStdTypes = allTypes.filter((t: string) =>
            t !== 'com.linkedin.messenger.Message' &&
            t !== 'com.linkedin.messenger.MessagingParticipant' &&
            t !== 'com.linkedin.messenger.Conversation'
          );
          const msgsWithAttrs = msgEntities.filter((m: any) => m.body?.attributes?.length > 0);

          if (richMsgs.length === 0 && nonStdTypes.length === 0 && msgsWithAttrs.length === 0) {
            // plain text only — log compactly
            if (scanned <= 20 || scanned % 10 === 0) {
              log(`[SCAN ${scanned}] ${conv.participantNames.join(', ')}: ${msgEntities.length} msgs, plain text`);
            }
            continue;
          }

          // Found rich content!
          richFound++;
          log('');
          log(`[RICH #${richFound}] === ${conv.participantNames.join(', ')} (conv ${scanned}) ===`);
          log(`[RICH #${richFound}] ${msgEntities.length} messages, ${richMsgs.length} with renderContent, ${msgsWithAttrs.length} with body.attributes`);
          log(`[RICH #${richFound}] $types: ${JSON.stringify(allTypes)}`);

          // Dump non-standard entity types in full
          for (const type of nonStdTypes) {
            const entities = included.filter((e: any) => e.$type === type);
            log(`[RICH #${richFound}] Entity type ${type}: ${entities.length} found`);
            for (let i = 0; i < Math.min(3, entities.length); i++) {
              log(`  [${i}] keys: ${Object.keys(entities[i]).join(', ')}`);
              log(`  [${i}] data: ${JSON.stringify(entities[i]).substring(0, 1000)}`);
            }
          }

          // Dump messages with renderContent
          for (let i = 0; i < Math.min(3, richMsgs.length); i++) {
            const m = richMsgs[i];
            log(`[RICH #${richFound} MSG ${i}] body: ${(m.body?.text || '(empty)').substring(0, 120)}`);
            log(`[RICH #${richFound} MSG ${i}] renderContent: ${JSON.stringify(m.renderContent).substring(0, 1200)}`);
            log(`[RICH #${richFound} MSG ${i}] fallbackText: ${m.renderContentFallbackText}`);
            log(`[RICH #${richFound} MSG ${i}] format: ${m.messageBodyRenderFormat}`);
            // Dump all keys and values for this message
            log(`[RICH #${richFound} MSG ${i}] ALL FIELDS:`);
            for (const [key, value] of Object.entries(m)) {
              const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
              log(`  ${key}: ${valStr.substring(0, 400)}`);
            }
          }

          // Dump messages with body.attributes
          for (let i = 0; i < Math.min(3, msgsWithAttrs.length); i++) {
            const m = msgsWithAttrs[i];
            log(`[RICH #${richFound} ATTR ${i}] body.text: ${(m.body?.text || '(empty)').substring(0, 120)}`);
            log(`[RICH #${richFound} ATTR ${i}] attributes: ${JSON.stringify(m.body.attributes).substring(0, 1000)}`);
          }
        } catch (err) {
          log(`[SCAN ${scanned}] ${conv.participantNames.join(', ')}: error — ${err}`);
        }
      }
      page++;
    }

    log('');
    log(`[SCAN COMPLETE] Scanned ${scanned} conversations, found ${richFound} with rich content`);
  } catch (err) {
    log(`[SCAN FAILED] ${err}`);
  }

  // 7. Current IndexedDB state
  log('');
  log('--- IndexedDB State ---');
  try {
    const allConvs = await db.conversations.toArray();
    log(`[DB] Total conversations: ${allConvs.length}`);
    const byCat: Record<string, number> = {};
    const byArchived: Record<string, number> = {};
    for (const c of allConvs) {
      byCat[c.category || 'UNDEFINED'] = (byCat[c.category || 'UNDEFINED'] || 0) + 1;
      byArchived[String(c.archived)] = (byArchived[String(c.archived)] || 0) + 1;
    }
    log(`[DB] By category: ${JSON.stringify(byCat)}`);
    log(`[DB] By archived: ${JSON.stringify(byArchived)}`);

    const msgCount = await db.messages.count();
    const profileCount = await db.profiles.count();
    log(`[DB] Messages: ${msgCount}, Profiles: ${profileCount}`);

    // Sample first 3 conversations
    const sample = allConvs.slice(0, 3);
    for (const c of sample) {
      log(`[DB SAMPLE] id=${c.id.substring(0, 25)}... cat=${c.category} archived=${c.archived} read=${c.read} names=${c.participantNames.join(', ')}`);
    }
  } catch (err) {
    log(`[DB ERROR] ${err}`);
  }

  // 8. Dexie schema info
  log('');
  log('--- Dexie Schema ---');
  try {
    log(`[SCHEMA] version: ${db.verno}`);
    for (const table of db.tables) {
      log(`[SCHEMA] ${table.name}: ${table.schema.primKey.name} indexes=[${table.schema.indexes.map(i => i.name).join(', ')}]`);
    }
  } catch (err) {
    log(`[SCHEMA ERROR] ${err}`);
  }

  log('');
  log('=== END DIAGNOSTIC REPORT ===');
  return lines.join('\n');
}
