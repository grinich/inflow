// Bug (Medium): ui-store touched window.matchMedia/document/localStorage at
// module load with no guards, so importing it in a non-DOM (node) context threw.
import { useUIStore } from '@/store/ui-store';

describe('ui-store loads in a node (no-DOM) environment', () => {
  it('imports without throwing and exposes a working store', () => {
    const s = useUIStore.getState();
    expect(s.inboxTab).toBeDefined();
    s.setInboxTab('other');
    expect(useUIStore.getState().inboxTab).toBe('other');
  });
});
