import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Without one, any render error unmounts the whole
 * React tree and leaves a blank page. This renders a recoverable fallback.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[inflow] Uncaught render error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
          <p className="text-sm font-medium text-fg-strong">Something went wrong.</p>
          <p className="max-w-md truncate text-xs text-fg-muted">{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
