import { sendBridgeMessage } from '@/lib/bridge';
import type { BridgeMessage, BridgeResponse } from '@/types/bridge';

/**
 * Where catalog handlers send their bridge messages. In a page, the default
 * — chrome.runtime.sendMessage via sendBridgeMessage — reaches the background
 * router. In the background service worker itself that send would go nowhere
 * (an extension's runtime message is not delivered back to its own listener),
 * so the external agent router injects handleMessage directly instead.
 */

type BridgeCaller = (msg: BridgeMessage) => Promise<BridgeResponse>;

let caller: BridgeCaller = sendBridgeMessage;

export function setAgentBridgeCaller(fn: BridgeCaller): void {
  caller = fn;
}

export function callAgentBridge(msg: BridgeMessage): Promise<BridgeResponse> {
  return caller(msg);
}
