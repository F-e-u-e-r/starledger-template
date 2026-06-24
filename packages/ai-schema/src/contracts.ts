/**
 * Crypto-free browser entrypoint: the public AI artifact CONTRACT — the zod
 * schemas and taxonomy with NO `node:crypto` dependency — so a browser bundle
 * (the dashboard) can strictly validate `ai-annotations.json` with the SAME
 * schema the classifier publishes, with zero drift.
 *
 * The main `.` entrypoint additionally exports the node-only `sha256` helper and
 * the job / candidate / manifest contracts; import from here when bundling for a
 * browser.
 */
export * from './taxonomy';
export * from './scalars';
export * from './execution-profile';
export * from './annotation';
export * from './artifact';
export * from './meta';
