import type { InvitationInsight } from '@/types/network';

/**
 * "Viren Baraiya and 62 other mutual connections".
 *
 * LinkedIn's payload names exactly one mutual and gives the true total
 * separately, so the sentence is built from those two rather than from a list
 * of names we don't have.
 */
export function mutualsLabel({ mutualCount, mutualNames }: InvitationInsight): string {
  const plural = `${mutualCount} mutual connection${mutualCount === 1 ? '' : 's'}`;
  const [first] = mutualNames;
  if (!first) return plural;
  const others = mutualCount - 1;
  if (others <= 0) return `${first} is a mutual connection`;
  return `${first} and ${others} other mutual connection${others === 1 ? '' : 's'}`;
}

/**
 * The faces-and-sentence row LinkedIn shows under a profile: a small overlapped
 * stack of the mutuals it named, then the count.
 *
 * The stack renders however many pictures came back — usually one — rather
 * than padding to a fixed number, so it never shows a face that isn't real.
 */
export function MutualConnections({ insight }: { insight: InvitationInsight }) {
  if (insight.mutualCount <= 0) return null;
  const faces = insight.mutualPictures.filter(Boolean).slice(0, 3);

  return (
    <div className="flex items-center gap-2">
      {faces.length > 0 && (
        <div className="flex shrink-0 -space-x-1.5">
          {faces.map((src, i) => (
            <img
              key={src + i}
              src={src}
              alt=""
              // Decorative: the sentence beside it already names them, so a
              // screen reader repeating each face adds nothing.
              aria-hidden
              loading="lazy"
              className="h-5 w-5 rounded-full object-cover ring-2 ring-surface"
            />
          ))}
        </div>
      )}
      <span className="min-w-0 truncate text-xs text-fg-muted">{mutualsLabel(insight)}</span>
    </div>
  );
}
