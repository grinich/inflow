import { GroupAvatar } from '../common/GroupAvatar';

interface Props {
  name: string;
  pictureUrl: string;
  /** Right-aligned on the name line — a relative time, usually. */
  timestamp?: string;
  /** The line under the name: a headline, in practice. */
  subtitle?: string;
  /** A note the person wrote, shown under the subtitle when there is one. */
  note?: string;
  selected: boolean;
  onSelect: () => void;
}

/**
 * A row in the network list, built to the conversation row's geometry.
 *
 * ConversationRow is the canonical list row, so this copies it rather than
 * approximating it: the same `gap-1.5 py-3 pl-1.5 pr-3`, the same 16px
 * indicator column before the avatar — which is what sets the avatar's inset,
 * and the reason network rows used to sit further left than inbox ones — and
 * the same type scale. The name is deliberately NOT bold: over there weight
 * means unread, so bolding every name here would claim something.
 *
 * The three network rows share this so they cannot drift from the inbox one at
 * a time.
 */
export function NetworkRow({ name, pictureUrl, timestamp, subtitle, note, selected, onSelect }: Props) {
  return (
    <button
      data-network-row
      aria-selected={selected}
      onClick={onSelect}
      className={`group relative flex w-full cursor-pointer items-center gap-1.5 border-b border-edge py-3 pl-1.5 pr-3 text-left ${
        selected ? 'bg-surface-active' : 'hover:bg-surface-hover'
      }`}
    >
      {/* The conversation row's unread/star column. Nothing to show here, but
          the space is what keeps the avatars on one vertical line across both
          lists. */}
      <div className="w-4 shrink-0" aria-hidden />

      <div className="relative shrink-0">
        <GroupAvatar names={[name]} pictures={[pictureUrl]} size={40} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-fg-secondary">{name}</span>
          {timestamp && (
            <span className="shrink-0 whitespace-nowrap text-xs text-fg-muted">{timestamp}</span>
          )}
        </div>
        {subtitle && <p className="truncate text-sm text-fg-muted">{subtitle}</p>}
        {note && <p className="truncate text-sm italic text-fg-muted">“{note}”</p>}
      </div>
    </button>
  );
}
