import type { BridgeMessage, BridgeResponse } from '@/types/bridge';
import { isDemoMode, handleDemoBridgeMessage } from './demo-mode';

export function sendBridgeMessage(message: BridgeMessage): Promise<BridgeResponse> {
  if (isDemoMode()) return handleDemoBridgeMessage(message);
  return chrome.runtime.sendMessage(message);
}
