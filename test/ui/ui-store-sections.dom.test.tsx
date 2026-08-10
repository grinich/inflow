// @vitest-environment jsdom
// Section + nav-rail state persists to localStorage via the store setters.
import '../dom-setup';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  useUIStore.setState({ activeSection: 'inbox', navRailCollapsed: false, composeNewActive: true });
});

it('setActiveSection persists and closes the composer', () => {
  useUIStore.getState().setActiveSection('connections');
  expect(useUIStore.getState().activeSection).toBe('connections');
  expect(useUIStore.getState().composeNewActive).toBe(false);
  expect(localStorage.getItem('inflow-section')).toBe('connections');
});

it('setNavRailCollapsed persists a 1/0 flag', () => {
  useUIStore.getState().setNavRailCollapsed(true);
  expect(useUIStore.getState().navRailCollapsed).toBe(true);
  expect(localStorage.getItem('inflow-nav-collapsed')).toBe('1');

  useUIStore.getState().setNavRailCollapsed(false);
  expect(localStorage.getItem('inflow-nav-collapsed')).toBe('0');
});

it('toggleNavRail flips and persists', () => {
  const before = useUIStore.getState().navRailCollapsed;
  useUIStore.getState().toggleNavRail();
  expect(useUIStore.getState().navRailCollapsed).toBe(!before);
  expect(localStorage.getItem('inflow-nav-collapsed')).toBe(!before ? '1' : '0');
});
