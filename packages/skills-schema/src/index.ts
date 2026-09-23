/**
 * Main entrypoint. Today identical to `./contracts`; node-only generator
 * helpers (M2.2) will land HERE so the browser bundle keeps importing the
 * crypto-free `./contracts` entrypoint (the `@starred/ai-schema` split).
 */
export * from './contracts';
