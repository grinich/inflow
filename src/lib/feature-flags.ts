/**
 * Compile-time feature flags.
 * Flip these to enable/disable features without removing code.
 */

/** Fetch enriched profile data (company, title, logo) from LinkedIn's identity API. */
export const ENABLE_PROFILE_ENRICHMENT = false;

/** AI-powered inline autocomplete in the compose box (uses Gemini 3.1 Flash Lite API). */
export const ENABLE_AI_AUTOCOMPLETE = true;
