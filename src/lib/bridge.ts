import type { BridgeMessage, BridgeResponse } from '@/types/bridge';

export function sendBridgeMessage(message: BridgeMessage): Promise<BridgeResponse> {
  return chrome.runtime.sendMessage(message);
}
