/**
 * Messages posted INTO the app frame by the inflow.im/app shell (the page
 * that embeds the app in an iframe). Currently one: a notification shown by
 * the shell was clicked, so navigate to its conversation.
 *
 * The origin check is the security boundary — only the shell's origin may
 * drive navigation; anything else is ignored.
 */

const SHELL_ORIGIN = 'https://inflow.im';

/** Subscribe to shell "open conversation" messages. Returns unsubscribe. */
export function onShellOpenConversation(
  handler: (conversationId: string) => void
): () => void {
  const listener = (event: MessageEvent) => {
    if (event.origin !== SHELL_ORIGIN) return;
    const data = event.data;
    if (
      data &&
      data.type === 'OPEN_CONVERSATION' &&
      typeof data.conversationId === 'string' &&
      data.conversationId
    ) {
      handler(data.conversationId);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
