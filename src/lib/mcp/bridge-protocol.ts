/**
 * Bridge protocol — the message contract between the inflow extension (tool
 * provider) and the local companion (MCP server / relay), spoken over a
 * localhost WebSocket. Kept pure and transport-free so it can be unit-tested;
 * bridge-client.ts wires it to a real WebSocket and the store.
 *
 * Flow: on open the extension sends `hello` (pairing token + advertised tools).
 * The companion replies `hello_ack` (or `error`). Thereafter the companion
 * forwards each of Claude's tool calls as `call`; the extension runs it and
 * replies `result`. `ping`/`pong` keep the socket warm.
 */
import type { McpToolDescriptor } from './tools';

export type BridgeStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

/** Companion-side facts reported on connect, for the in-app activity feed. */
export interface CompanionStatus {
  /** Full build identity, e.g. "0.1.0.214" ("dev" when never stamped). */
  version?: string;
  /** Short git sha of the build, when known. */
  commit?: string;
  /** Commit of the companion's own code — what staleness is judged on. */
  codeCommit?: string;
  /** Localhost port the bridge is on. */
  port?: number;
  /** False when this companion relays through another that owns the bridge. */
  ownsBridge?: boolean;
  /** How many tools it is advertising to its MCP client. */
  tools?: number;
  /** Other Claude clients relaying through it. */
  peers?: number;
}

/** Which provider keys the companion holds (advertised in hello_ack). */
export interface CompanionKeys {
  anthropic: boolean;
  gemini: boolean;
}

/** Messages the companion sends to the extension. */
export type InboundMessage =
  // `keys` tells the extension which provider keys the companion holds, so it can
  // route a provider through the companion only when that key is actually set.
  | { type: 'hello_ack'; keys?: Partial<CompanionKeys>; status?: CompanionStatus }
  | { type: 'error'; message?: string }
  | { type: 'call'; id: string; name: string; args?: Record<string, any> }
  | { type: 'ping' }
  // A line for the in-app activity feed, pushed by the companion.
  | { type: 'activity'; text?: string }
  // Reply to an `anthropic` request the extension sent (the in-app Claude agent).
  | { type: 'anthropic_result'; id: string; ok: boolean; data?: any; error?: string }
  // Reply to a `gemini` request (server-side Gemini, key kept in the companion).
  | { type: 'gemini_result'; id: string; ok: boolean; data?: any; error?: string };

export interface BridgeHandlers {
  token: string;
  tools: McpToolDescriptor[];
  callTool: (name: string, args: Record<string, any>) => Promise<unknown>;
  send: (msg: object) => void;
  onStatus: (status: BridgeStatus, error?: string) => void;
  onActivity: (text: string) => void;
  /** Companion code sha this build expects, for the staleness comparison. */
  appCompanionSha?: string;
  /** Learn which provider keys the companion holds (from hello_ack). */
  onCompanionKeys?: (keys: CompanionKeys) => void;
  /** Resolve a pending Anthropic proxy request (bridge-client owns the map). */
  onAnthropicResult?: (id: string, ok: boolean, data: any, error?: string) => void;
  /** Resolve a pending Gemini proxy request (bridge-client owns the map). */
  onGeminiResult?: (id: string, ok: boolean, data: any, error?: string) => void;
}

/** Friendly one-line description of a tool call for the activity feed. */
export function activityLabel(name: string, args: Record<string, any> = {}): string {
  switch (name) {
    case 'search_connections':
      return `Claude searched your connections${args.query ? ` for “${args.query}”` : ''}`;
    case 'list_connections':
      return `Claude listed connections${args.role ? ` (${args.role})` : args.interest ? ` (${args.interest})` : ''}`;
    case 'get_connection':
      return 'Claude looked up a connection';
    case 'get_network_stats':
      return 'Claude reviewed your network stats';
    case 'get_conversation_summary':
      return 'Claude read a conversation summary';
    case 'search_messages':
      return `Claude searched your messages${args.query ? ` for “${args.query}”` : ''}`;
    case 'list_conversations':
      return `Claude reviewed your inbox${args.awaitingReply ? ' (awaiting your reply)' : ''}`;
    case 'get_thread':
      return 'Claude read a conversation';
    case 'find_stale_connections':
      return 'Claude looked for people to reconnect with';
    case 'create_draft':
      return 'Claude drafted a message → Outbox';
    default:
      return `Claude used ${name}`;
  }
}

/**
 * One readable line about the companion we just paired with. Older companions
 * send no status, so say only what we actually know rather than inventing it.
 */
export function describeCompanion(status?: CompanionStatus): string {
  if (!status) return 'Companion ready (older build — no details reported)';
  const parts: string[] = [];
  parts.push(
    status.ownsBridge === false
      ? 'relaying through another companion'
      : `bridge on 127.0.0.1:${status.port ?? '?'}`,
  );
  if (typeof status.tools === 'number') parts.push(`${status.tools} tools`);
  if (status.peers) parts.push(`${status.peers} other Claude client${status.peers === 1 ? '' : 's'}`);
  const version = status.version ? ` v${status.version}` : '';
  const commit = status.commit ? ` (${status.commit})` : '';
  return `Companion${version}${commit} ready — ${parts.join(' · ')}`;
}

/**
 * Whether the companion came from the same commit as this extension — the
 * question you actually want answered after rebuilding one half.
 *
 * Compares commit shas, NOT build numbers: CI stamps the extension with its run
 * number while the companion always uses the git commit count, so identical
 * code can carry different numbers. Returns null when either side can't say,
 * rather than guessing a match or crying wolf.
 */
/**
 * Compares the COMPANION'S OWN code, not the repo it was packed from. An
 * earlier version compared repo HEAD, so any commit at all — a test fix, an
 * icon — made the two diverge and told the user to reinstall a companion that
 * was perfectly current. A reinstall only ever helps when the companion's own
 * code changed; its tool catalog refreshes live at pairing.
 *
 * Returns null when either side cannot say (an older companion sends no
 * codeCommit), because a confident wrong answer here costs the user a pointless
 * reinstall and makes the warning easy to ignore when it is real.
 */
export function describeBuildMatch(status?: CompanionStatus, appCompanionSha?: string): string | null {
  const theirs = status?.codeCommit;
  if (!theirs || !appCompanionSha || theirs === 'unknown' || appCompanionSha === 'nogit') return null;
  if (theirs === appCompanionSha) return 'Companion is up to date ✓';
  return (
    `Companion is out of date — it has ${theirs}, this build expects ${appCompanionSha}. ` +
    'Reinstall it from the MCP connector.'
  );
}

export function createBridgeSession(h: BridgeHandlers) {
  return {
    /** Call once the socket opens: authenticate and advertise the toolbox. */
    open() {
      h.onStatus('connecting');
      h.send({ type: 'hello', token: h.token, tools: h.tools });
    },

    /** Handle one raw message from the companion. */
    async handleMessage(raw: string) {
      let msg: InboundMessage;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // ignore malformed frames
      }
      switch (msg.type) {
        case 'hello_ack':
          h.onStatus('connected');
          h.onActivity('Connected to Claude');
          h.onActivity(describeCompanion(msg.status));
          {
            const match = describeBuildMatch(msg.status, h.appCompanionSha);
            if (match) h.onActivity(match);
          }
          // Older companions omit `keys`. Preserve the prior behavior (Anthropic
          // routed through the companion when connected) and require an explicit
          // signal to route Gemini through it.
          h.onCompanionKeys?.({
            anthropic: msg.keys ? !!msg.keys.anthropic : true,
            gemini: msg.keys ? !!msg.keys.gemini : false,
          });
          return;
        case 'error':
          h.onStatus('error', msg.message || 'Connection rejected');
          return;
        case 'ping':
          h.send({ type: 'pong' });
          return;
        case 'activity':
          if (msg.text) h.onActivity(msg.text);
          return;
        case 'anthropic_result':
          h.onAnthropicResult?.(msg.id, msg.ok, msg.data, msg.error);
          return;
        case 'gemini_result':
          h.onGeminiResult?.(msg.id, msg.ok, msg.data, msg.error);
          return;
        case 'call': {
          h.onActivity(activityLabel(msg.name, msg.args));
          try {
            const data = await h.callTool(msg.name, msg.args || {});
            h.send({ type: 'result', id: msg.id, ok: true, data });
          } catch (e: any) {
            h.send({ type: 'result', id: msg.id, ok: false, error: e?.message || 'Tool failed' });
          }
          return;
        }
      }
    },
  };
}
