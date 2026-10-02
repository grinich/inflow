import type { MessageAttachment } from '../../types/message.js';
// Upstream MCP returns attachment summaries, not media URLs.
export function SharedPostCard({attachment}:{attachment:MessageAttachment;isMe:boolean}){
  return <span className="text-xs text-fg-muted">{attachment.fileName || 'Shared post'} · View in Inflow</span>;
}
