/**
 * Demo mode has to carry the sections this branch added, not just the inbox.
 *
 * It is the only way to see Connections, Insights or the Outbox without a real
 * LinkedIn account, an API key, and someone's actual network on screen — which
 * is what makes it the only safe source of screenshots, and the fastest way
 * for a reviewer to try any of this.
 */
import { switchDatabase, db } from '@/db/database';
import { seedDemoData } from '@/lib/demo-mode';
import { DEMO_PEOPLE, DEMO_PROFILES } from '@/lib/demo-data';
import { computeInsights } from '@/lib/connection-insights';

beforeEach(async () => {
  await switchDatabase('demo-seed-' + Math.random().toString(36).slice(2));
  await seedDemoData();
});

it('describes every demo person, so no one shows up uncategorised', () => {
  expect(DEMO_PROFILES).toHaveLength(DEMO_PEOPLE.length);
  for (const p of DEMO_PROFILES) {
    expect(p.role, p.headline).toBeTruthy();
    expect(p.headline).toBeTruthy();
    expect(p.company).toBeTruthy();
  }
});

it('seeds connections that are already categorised', async () => {
  const rows = await db!.connections.toArray();
  expect(rows).toHaveLength(DEMO_PEOPLE.length);
  expect(rows.every((c) => !!c.roleCategory)).toBe(true);
  expect(rows.every((c) => !!c.aiSummary)).toBe(true);
  expect(rows.some((c) => (c.interestTags?.length ?? 0) > 0)).toBe(true);
});

it('gives Insights a lopsided mix, because an even pie says nothing', async () => {
  const insights = computeInsights(await db!.connections.toArray());
  // At least five roles so the chart has shape, and a clear leader.
  expect(insights.roles.length).toBeGreaterThanOrEqual(5);
  expect(insights.roles[0].count).toBeGreaterThan(insights.roles[insights.roles.length - 1].count);
  expect(insights.companies.length).toBeGreaterThanOrEqual(3);
});

it('seeds an Outbox covering each state the queue can be in', async () => {
  const queue = await db!.scheduledMessages.toArray();
  expect(queue.length).toBeGreaterThanOrEqual(3);

  expect(queue.some((m) => m.status === 'draft' && m.inMailSubject === undefined)).toBe(true);
  expect(queue.some((m) => m.status === 'scheduled' && (m.scheduledAt ?? 0) > Date.now())).toBe(true);

  // An InMail Claude drafted, deliberately left unconfirmed so the demo shows
  // Send disabled until a human checks the profile.
  const inMail = queue.find((m) => m.inMailSubject !== undefined)!;
  expect(inMail.source).toBe('mcp');
  expect(inMail.recipientConfirmedAt).toBeUndefined();
  expect(inMail.profileUrl).toMatch(/^https:\/\/www\.linkedin\.com\/in\//);
});

it('never seeds a message that could send itself', async () => {
  // Demo mode must not look like it is about to contact anyone.
  const queue = await db!.scheduledMessages.toArray();
  expect(queue.every((m) => m.status !== 'sending' && m.status !== 'sent')).toBe(true);
});

it('re-seeds cleanly rather than doubling up', async () => {
  await seedDemoData();
  expect(await db!.connections.count()).toBe(DEMO_PEOPLE.length);
});

it('fills in the new sections for a demo database seeded before they existed', async () => {
  // The freshness check used to look only at conversations, so a demo database
  // from an older build had valid portraits, returned early, and never got
  // connections or an Outbox — which is exactly what reloading the extension
  // looked like: nothing new appeared.
  await db!.connections.clear();
  await db!.scheduledMessages.clear();

  await seedDemoData();

  expect(await db!.connections.count()).toBe(DEMO_PEOPLE.length);
  expect(await db!.scheduledMessages.count()).toBeGreaterThanOrEqual(3);
});
