/**
 * Build-time flag from wxt.config.ts: this build allows the inflow.im/app
 * shell to be served from localhost, for testing it with `vercel dev`.
 * Always false in a release build.
 */
declare const __INFLOW_LOCAL_SHELL__: boolean;
