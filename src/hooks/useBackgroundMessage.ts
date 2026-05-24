import { useEffect } from 'react';

type MessageHandler = (message: any) => void;

export function useBackgroundMessage(handler: MessageHandler) {
  useEffect(() => {
    chrome.runtime.onMessage.addListener(handler);
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, [handler]);
}
