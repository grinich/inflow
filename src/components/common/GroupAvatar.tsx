import { useState } from 'react';
import { useCachedImage } from '@/hooks/useCachedImage';

interface GroupAvatarProps {
  names: string[];
  pictures: string[];
  /** Overall size in pixels. Default 40. */
  size?: number;
}

function AvatarCircle({ url, name, size }: { url: string; name: string; size: number }) {
  const src = useCachedImage(url || undefined);
  const [failed, setFailed] = useState(false);
  const initial = (name || '?').charAt(0).toUpperCase();

  return src && !failed ? (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className="h-full w-full rounded-full object-cover"
    />
  ) : (
    <div
      className="flex items-center justify-center rounded-full bg-surface-muted text-fg-secondary"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initial}
    </div>
  );
}

/**
 * Displays one or two overlapping avatars, iMessage-style.
 * For group conversations the front avatar is index 0 (most recent sender)
 * and the back avatar is index 1.
 */
export function GroupAvatar({ names, pictures, size = 40 }: GroupAvatarProps) {
  if (names.length <= 1) {
    // Single avatar
    return (
      <div
        className="shrink-0 overflow-hidden rounded-full bg-surface-muted"
        style={{ width: size, height: size }}
      >
        <AvatarCircle url={pictures[0] || ''} name={names[0] || '?'} size={size} />
      </div>
    );
  }

  // Two overlapping avatars
  const small = Math.round(size * 0.72);
  const offset = size - small;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* Back avatar (second participant) — top-left */}
      <div
        className="absolute overflow-hidden rounded-full bg-surface-muted ring-2 ring-surface"
        style={{ width: small, height: small, top: 0, left: 0 }}
      >
        <AvatarCircle url={pictures[1] || ''} name={names[1] || '?'} size={small} />
      </div>
      {/* Front avatar (first participant / most recent) — bottom-right, on top */}
      <div
        className="absolute overflow-hidden rounded-full bg-surface-muted ring-2 ring-surface"
        style={{ width: small, height: small, top: offset, left: offset }}
      >
        <AvatarCircle url={pictures[0] || ''} name={names[0] || '?'} size={small} />
      </div>
    </div>
  );
}
