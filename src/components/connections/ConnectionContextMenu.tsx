import { useEffect, useState } from 'react';
import { db } from '@/db/database';
import { useConnectionInterests } from '@/hooks/useConnectionInterests';
import { connectionProfileUrl, roleBadgeClass, interestTagClass } from './connection-format';
import { ROLE_CATEGORIES, type ConnectionRole, type Connection } from '@/types/connection';

interface Props {
  connection: Connection;
  x: number;
  y: number;
  onClose: () => void;
}

const MENU_WIDTH = 240;

/**
 * Right-click menu for a connection: set its role or toggle interest tags
 * manually (and open the profile). Manual edits stamp `categorizedAt` so the
 * auto-categorizer won't overwrite the user's choice.
 */
export function ConnectionContextMenu({ connection, x, y, onClose }: Props) {
  const [interests] = useConnectionInterests();
  const [role, setRoleState] = useState<ConnectionRole | undefined>(connection.roleCategory);
  const [tags, setTags] = useState<string[]>(connection.interestTags ?? []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const setRole = async (r: ConnectionRole) => {
    setRoleState(r);
    if (db) await db.connections.update(connection.profileUrn, { roleCategory: r, categorizedAt: Date.now() });
  };

  const toggleTag = async (tag: string) => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setTags(next);
    if (db) {
      await db.connections.update(connection.profileUrn, {
        interestTags: next,
        categorizedAt: connection.categorizedAt || Date.now(),
      });
    }
  };

  // Keep the menu on-screen.
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(y, window.innerHeight - 340);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        role="menu"
        aria-label={`Edit ${connection.fullName || 'connection'}`}
        onClick={(e) => e.stopPropagation()}
        style={{ left, top, width: MENU_WIDTH }}
        className="absolute max-h-[80vh] overflow-y-auto rounded-lg bg-surface-raised py-1 text-sm shadow-2xl ring-1 ring-edge"
      >
        <div className="truncate px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
          {connection.fullName || 'Connection'}
        </div>

        <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-fg-muted">Set role</div>
        {ROLE_CATEGORIES.map((r) => (
          <button
            key={r}
            role="menuitemradio"
            aria-checked={role === r}
            onClick={() => setRole(r)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${role === r ? 'bg-blue-400' : 'bg-transparent ring-1 ring-inset ring-edge'}`} />
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${roleBadgeClass(r)}`}>{r}</span>
          </button>
        ))}

        <div className="my-1 border-t border-edge" />
        <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-fg-muted">Tags</div>
        {interests.length === 0 ? (
          <div className="px-3 py-1.5 text-[11px] text-fg-faint">No interest tags yet — add some in Tags.</div>
        ) : (
          interests.map((tag) => (
            <button
              key={tag}
              role="menuitemcheckbox"
              aria-checked={tags.includes(tag)}
              onClick={() => toggleTag(tag)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-hover"
            >
              <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded ring-1 ring-inset ${tags.includes(tag) ? 'bg-blue-500/30 ring-blue-500/40 text-blue-200' : 'ring-edge text-transparent'}`}>✓</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${interestTagClass(tag)}`}>★ {tag}</span>
            </button>
          ))
        )}

        <div className="my-1 border-t border-edge" />
        <button
          role="menuitem"
          onClick={() => {
            window.open(connectionProfileUrl(connection.publicId, connection.fullName || 'Unknown'), '_blank', 'noopener,noreferrer');
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong"
        >
          Open LinkedIn profile
        </button>
      </div>
    </div>
  );
}
