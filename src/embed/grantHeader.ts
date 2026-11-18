/**
 * Lives apart from `grant.ts` so the browser can name the header without
 * importing `node:crypto` along with it.
 */
export const GRANT_HEADER = "x-embed-grant";
