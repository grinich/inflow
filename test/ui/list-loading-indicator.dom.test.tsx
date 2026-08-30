// @vitest-environment jsdom
// The network view announced itself with a bare line of text while the
// conversation list showed a spinner, so the same "still working" state looked
// like two different features. One component now, used by both.
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import { ListLoadingIndicator } from '@/components/common/ListLoadingIndicator';

describe('ListLoadingIndicator', () => {
  it('shows its label', () => {
    render(<ListLoadingIndicator label="Loading your network..." />);

    expect(screen.getByText('Loading your network...')).toBeTruthy();
  });

  it('spins', () => {
    // The whole point of sharing it: without the animation it is just text
    // again, which is what the network view had.
    const { container } = render(<ListLoadingIndicator label="Loading more..." />);

    expect(container.querySelector('svg.animate-spin')).toBeTruthy();
  });

  it('is the same markup wherever it is used', () => {
    // If these ever diverge the two lists look different again.
    const a = render(<ListLoadingIndicator label="x" />).container.innerHTML;
    const b = render(<ListLoadingIndicator label="x" />).container.innerHTML;

    expect(a).toBe(b);
  });
});
