// MCP summaries omit private media URLs; no Chrome image-fetch transport.
import { sanitizeUrl } from '../lib/sanitize-url.js';
export function useCachedImage(url?: string) { return url ? sanitizeUrl(url) : ''; }
export function preloadImages(_urls: string[]) { return () => {}; }
