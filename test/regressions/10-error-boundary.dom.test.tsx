// @vitest-environment jsdom
// Bug (Medium): no React error boundary — any render error blanked the whole app.
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('kaboom');
}

it('renders a recoverable fallback when a child throws instead of unmounting everything', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  expect(screen.getByText(/reload/i)).toBeInTheDocument();
  spy.mockRestore();
});
