/**
 * Promise that resolves once the background DB is pointed at the correct account.
 * Message handlers that read/write the DB await this before proceeding.
 */
let _resolve: () => void;
export const dbReady = new Promise<void>((r) => { _resolve = r; });
export function markDbReady(): void { _resolve(); }
