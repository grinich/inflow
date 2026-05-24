import { useState, useEffect, type ReactNode } from 'react';
import { sendBridgeMessage } from '@/lib/bridge';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  useEffect(() => {
    checkAuth();
    const handleFocus = () => checkAuth();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  async function checkAuth() {
    try {
      const res = await sendBridgeMessage({ type: 'CHECK_AUTH' });
      if (res.success && res.data?.authenticated) {
        setState('authenticated');
      } else {
        setState('unauthenticated');
      }
    } catch {
      setState('unauthenticated');
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface text-fg-secondary">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-fg-faint border-t-blue-500" />
          <span className="text-sm">Connecting to LinkedIn...</span>
        </div>
      </div>
    );
  }

  if (state === 'unauthenticated') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface text-fg">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-fg-strong">Sign in to LinkedIn</h1>
          <p className="mb-6 text-sm text-fg-secondary">
            inƒloⱳ reads your LinkedIn messages using your existing session.
            Please sign in to LinkedIn in another tab first.
          </p>
          <a
            href="https://www.linkedin.com/login"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Open LinkedIn Login
          </a>
          <button
            onClick={checkAuth}
            className="mt-4 block w-full text-sm text-fg-muted transition-colors hover:text-fg-secondary"
          >
            I've signed in — check again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
