// @vitest-environment jsdom
// The shared Toggle: correct ARIA state and it flips on click.
import '../dom-setup';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from '@/components/common/Toggle';

it('reflects checked state via aria and the knob transform', () => {
  const { rerender } = render(<Toggle label="Auto" checked={false} onChange={() => {}} />);
  const sw = screen.getByRole('switch', { name: 'Auto' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  // Off state: knob nudged just inside the left.
  expect(sw.querySelector('span')?.className).toContain('translate-x-1');

  rerender(<Toggle label="Auto" checked onChange={() => {}} />);
  expect(sw).toHaveAttribute('aria-checked', 'true');
  // On state: knob travels right but stays inside the track.
  expect(sw.querySelector('span')?.className).toContain('translate-x-6');
});

it('calls onChange with the toggled value', () => {
  const onChange = vi.fn();
  render(<Toggle label="Auto" checked={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Auto' }));
  expect(onChange).toHaveBeenCalledWith(true);
});

it('does not fire when disabled', () => {
  const onChange = vi.fn();
  render(<Toggle label="Auto" checked={false} disabled onChange={onChange} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Auto' }));
  expect(onChange).not.toHaveBeenCalled();
});
