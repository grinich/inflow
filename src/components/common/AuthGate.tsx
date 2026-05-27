import { useState, useEffect, type ReactNode } from 'react';
import { sendBridgeMessage } from '@/lib/bridge';
import { switchDatabase, memberIdFromUrn, getActiveAccountId } from '@/db/database';
import { isDemoMode, seedDemoData, startDemoIncoming, stopDemoIncoming } from '@/lib/demo-mode';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [online, setOnline] = useState(navigator.onLine);
  const [accountKey, setAccountKey] = useState(() => getActiveAccountId() || 'default');

  // Track browser online/offline state
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Re-check auth when coming back online
  useEffect(() => {
    if (online && authState === 'unauthenticated') {
      checkAuth();
    }
  }, [online]);

  useEffect(() => {
    checkAuth();
    const handleFocus = () => checkAuth();
    window.addEventListener('focus', handleFocus);

    const handleMessage = (msg: any) => {
      if (msg.type === 'ACCOUNT_CHANGED') {
        checkAuth();
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      window.removeEventListener('focus', handleFocus);
      chrome.runtime.onMessage.removeListener(handleMessage);
      stopDemoIncoming();
    };
  }, []);

  async function checkAuth() {
    // Demo mode: skip real auth, use local DB
    if (isDemoMode()) {
      await switchDatabase('demo');
      await seedDemoData();
      startDemoIncoming();
      try { localStorage.setItem('inflow-account-name', 'Demo User'); } catch {}
      setAccountKey('demo');
      setAuthState('authenticated');
      return;
    }

    try {
      const res = await sendBridgeMessage({ type: 'CHECK_AUTH' });
      if (res.success && res.data?.authenticated) {
        const memberUrn = res.data.memberUrn;
        if (memberUrn) {
          const memberId = memberIdFromUrn(memberUrn);
          if (memberId) {
            await switchDatabase(memberId);
            if (memberId !== accountKey) {
              setAccountKey(memberId);
            }
          }
        }

        if (res.data.displayName) {
          try { localStorage.setItem('inflow-account-name', res.data.displayName); } catch {}
        }
        if (res.data.profilePicture) {
          try { localStorage.setItem('inflow-account-picture', res.data.profilePicture); } catch {}
        }

        setAuthState('authenticated');
      } else {
        // If we're offline, don't show the sign-in screen — keep current state
        // or show authenticated with offline banner if we have a stored account
        if (!navigator.onLine) {
          if (authState === 'loading') {
            const storedAccount = getActiveAccountId();
            setAuthState(storedAccount ? 'authenticated' : 'unauthenticated');
          }
          // If already authenticated, stay authenticated
        } else {
          setAuthState('unauthenticated');
        }
      }
    } catch {
      if (!navigator.onLine) {
        if (authState === 'loading') {
          const storedAccount = getActiveAccountId();
          setAuthState(storedAccount ? 'authenticated' : 'unauthenticated');
        }
      } else {
        setAuthState('unauthenticated');
      }
    }
  }

  if (authState === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface text-fg-secondary">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-fg-faint border-t-blue-500" />
          <span className="text-sm">Connecting to LinkedIn...</span>
        </div>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface text-fg">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-fg-strong">Sign in to LinkedIn</h1>
          <p className="mb-6 text-sm text-fg-secondary">
            inƒlow reads your LinkedIn messages using your existing session.
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

  return (
    <div key={accountKey} className="flex h-screen flex-col">
      {!online && (
        <div className="flex h-5 shrink-0 items-center justify-center bg-blue-400/80 text-[10px] font-medium tracking-wide text-white">
          OFFLINE
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
