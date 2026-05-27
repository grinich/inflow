import type { Message } from '@/types/message';

const MAX_MESSAGES = 8;
const MAX_MSG_LENGTH = 100;

/**
 * Build a prompt asking the AI for 3 short reply suggestions.
 * Returns null if there isn't enough context.
 */
export function buildReplySuggestionsPrompt(
  messages: Message[],
  participantNames: string[],
): string | null {
  if (messages.length === 0) return null;

  const otherName = participantNames.length > 0 ? participantNames[0] : 'Them';

  const recent = messages.slice(-MAX_MESSAGES);

  const lines = recent.map((msg) => {
    const sender = msg.isFromMe ? 'You' : otherName;
    const text = msg.body.length > MAX_MSG_LENGTH
      ? msg.body.slice(0, MAX_MSG_LENGTH) + '...'
      : msg.body;
    return `${sender}: ${text}`;
  });

  const header = `Conversation with ${otherName}:`;
  const history = lines.join('\n');

  return [
    header,
    history,
    '---',
    'Suggest exactly 3 short replies I could send next.',
    'Rules:',
    '- Match the tone and formality of my previous messages in the conversation',
    '- Each reply 2-10 words, casual and natural for LinkedIn DMs',
    '- Make each option meaningfully different (e.g. agree, ask a question, suggest next step)',
    '- If they seem to be scheduling a meeting, make the first suggestion propose a time or offer availability',
    '- No emojis, no exclamation marks, no filler like "Sure thing!"',
    'Separate the 3 replies with | and output nothing else.',
  ].join('\n');
}
