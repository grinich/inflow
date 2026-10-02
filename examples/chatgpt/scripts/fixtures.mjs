export function startFixtureBridge(base, headers) {
  const fixture = [
    ['maya', 'Maya Chen', 'Sounds good. Looking forward to catching up.', true],
    ['alex', 'Alex Rivera', 'Thanks for sharing — I’ll take a closer look.', true],
    ['sam', 'Sam Taylor', 'Would Thursday afternoon work for you?', false],
    ['jordan', 'Jordan Lee', 'Great meeting you at the event yesterday.', false],
    ['robin', 'Robin Park', 'Just sent over the notes we discussed.', false],
  ].map(([id, name, msg, unread], i) => ({
    id,
    participants: [name],
    lastMessage: msg,
    lastActivityAt: new Date(Date.now() - i * 86400000).toISOString(),
    unread,
    starred: i === 2,
    archived: false,
    category: 'PRIMARY_INBOX',
    hasAttachments: false,
  }));
  let stop = false;
  const pump = (async () => {
    while (!stop) {
      try {
        const response = await fetch(`${base}/bridge/poll`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ connected: true }),
          signal: AbortSignal.timeout(22000),
        });
        if (!response.ok) throw new Error(`Fixture bridge HTTP ${response.status}`);
        const { commands } = await response.json();
        for (const c of commands || []) {
          const person = fixture.find((x) => x.id === c.input.conversationId) || fixture[0];
          const payload =
            c.tool === 'list_conversations'
              ? { conversations: fixture, total: 5, nextOffset: null }
              : {
                  conversation: person,
                  messages: [
                    {
                      id: 'm1',
                      from: person.participants[0],
                      isFromMe: false,
                      at: new Date(Date.now() - 240000).toISOString(),
                      body: 'Hi! It was lovely meeting you yesterday. I enjoyed our conversation about what you’re building.',
                    },
                    {
                      id: 'm2',
                      from: 'You',
                      isFromMe: true,
                      at: new Date(Date.now() - 180000).toISOString(),
                      body: 'Likewise! Thanks for making the time. Shall we pick this up over coffee next week?',
                    },
                    {
                      id: 'm3',
                      from: person.participants[0],
                      isFromMe: false,
                      at: new Date(Date.now() - 60000).toISOString(),
                      body: 'Sounds good. Looking forward to catching up.',
                    },
                  ],
                  refreshed: true,
                };
          await fetch(`${base}/bridge/result`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              id: c.id,
              result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
            }),
          });
        }
      } catch {
        if (!stop) throw new Error('Fixture bridge failed');
      }
    }
  })();
  return async () => {
    stop = true;
    await pump;
    await fetch(`${base}/bridge/poll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ connected: false }),
    });
  };
}
