import type { Message } from '@/types/message';

const MAX_MESSAGES = 8;
const MAX_MSG_LENGTH = 100;

/**
 * Build a prompt for the AI autocomplete model.
 * Returns null if there isn't enough context to predict meaningfully.
 */
export function buildAutocompletePrompt(
  messages: Message[],
  participantNames: string[],
  currentBody: string,
): string | null {
  if (!currentBody || currentBody.length < 5) return null;

  const otherName = participantNames.length > 0 ? participantNames[0] : 'Them';

  // Take the last N messages for context
  const recent = messages.slice(-MAX_MESSAGES);

  const lines = recent.map((msg) => {
    const sender = msg.isFromMe ? 'You' : otherName;
    const text = msg.body.length > MAX_MSG_LENGTH
      ? msg.body.slice(0, MAX_MSG_LENGTH) + '...'
      : msg.body;
    return `${sender}: ${text}`;
  });

  const header = `Conversation with ${otherName}:`;
  const history = lines.length > 0 ? lines.join('\n') : '';
  const current = `You: ${currentBody}`;

  const parts = [header];
  if (history) parts.push(history);
  parts.push(current);
  parts.push('---');
  parts.push('Complete the message. Output only the next few words:');

  return parts.join('\n');
}
