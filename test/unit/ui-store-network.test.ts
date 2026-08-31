import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '@/store/ui-store';

describe('ui-store network state', () => {
  beforeEach(() => {
    useUIStore.setState({ appView: 'inbox', networkTab: 'invitations', networkSelectedIndex: 0 });
  });

  it('defaults to inbox view', () => {
    expect(useUIStore.getState().appView).toBe('inbox');
  });

  it('setAppView switches views and resets network selection', () => {
    useUIStore.setState({ networkSelectedIndex: 5 });
    useUIStore.getState().setAppView('network');
    expect(useUIStore.getState().appView).toBe('network');
    expect(useUIStore.getState().networkSelectedIndex).toBe(0);
  });

  it('setNetworkTab switches tabs and resets selection', () => {
    useUIStore.setState({ networkSelectedIndex: 3 });
    useUIStore.getState().setNetworkTab('connections');
    expect(useUIStore.getState().networkTab).toBe('connections');
    expect(useUIStore.getState().networkSelectedIndex).toBe(0);
  });

  it('setNetworkSelectedIndex clamps at 0', () => {
    useUIStore.getState().setNetworkSelectedIndex(-2);
    expect(useUIStore.getState().networkSelectedIndex).toBe(0);
  });

  it('setAppView does not reset selection when view is unchanged', () => {
    useUIStore.setState({ appView: 'network', networkSelectedIndex: 7 });
    useUIStore.getState().setAppView('network');
    expect(useUIStore.getState().networkSelectedIndex).toBe(7);
  });

  it('setNetworkTab does not reset selection when tab is unchanged', () => {
    useUIStore.setState({ networkTab: 'connections', networkSelectedIndex: 4 });
    useUIStore.getState().setNetworkTab('connections');
    expect(useUIStore.getState().networkSelectedIndex).toBe(4);
  });
});
