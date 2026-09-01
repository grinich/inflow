// @vitest-environment jsdom
/**
 * whenModelContextReady waits for an agent extension to inject its WebMCP
 * surface, which happens when the user grants the agent access to the site —
 * usually long after our page loaded and checked.
 *
 * The cost side matters as much as the detection: with no agent installed,
 * which is the common case, this must not leave a timer ticking for the life
 * of the tab.
 */
import '../dom-setup';
import { whenModelContextReady } from '@/lib/agent-tools/model-context';
import { installModelContextMock, uninstallModelContextMock } from '../mocks/model-context';

afterEach(() => {
  uninstallModelContextMock();
  vi.useRealTimers();
});

it('fires immediately when a surface already exists, with no timer left behind', () => {
  vi.useFakeTimers();
  installModelContextMock();
  const onReady = vi.fn();

  whenModelContextReady(onReady);

  expect(onReady).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('fires when the surface is injected later', () => {
  vi.useFakeTimers();
  const onReady = vi.fn();
  whenModelContextReady(onReady);
  expect(onReady).not.toHaveBeenCalled();

  installModelContextMock(); // the agent arrives
  vi.advanceTimersByTime(2100);

  expect(onReady).toHaveBeenCalledTimes(1);
});

it('stops polling after the window, instead of ticking for the life of the tab', () => {
  vi.useFakeTimers();
  whenModelContextReady(vi.fn());
  expect(vi.getTimerCount()).toBeGreaterThan(0);

  // Two minutes of nothing: give up on polling.
  vi.advanceTimersByTime(120_001);
  expect(vi.getTimerCount()).toBe(0);
});

it('still detects a late arrival on focus, after polling has given up', () => {
  vi.useFakeTimers();
  const onReady = vi.fn();
  whenModelContextReady(onReady);
  vi.advanceTimersByTime(120_001); // polling window elapsed

  installModelContextMock();
  window.dispatchEvent(new Event('focus'));

  // The listener is the part that has to outlive the poll: granting an agent
  // access to the site is a deliberate act that happens whenever it happens.
  expect(onReady).toHaveBeenCalledTimes(1);
});

it('the returned stop() removes the listeners too', () => {
  vi.useFakeTimers();
  const onReady = vi.fn();
  const stop = whenModelContextReady(onReady);

  stop();
  installModelContextMock();
  window.dispatchEvent(new Event('focus'));
  vi.advanceTimersByTime(10_000);

  expect(onReady).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
