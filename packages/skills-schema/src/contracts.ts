/**
 * Crypto-free browser entrypoint: the public skills-classification CONTRACT —
 * zod schemas, invariants, canonical serializers, and version literals with NO
 * `node:` dependency — so the dashboard's fail-soft loader (M2.3) validates
 * `skills-classification.json` with the SAME schema the generator (M2.2)
 * publishes, with zero drift (P7 §4).
 */
export * from './constants';
export * from './scalars';
export * from './artifact';
export * from './meta';
export * from './aliases';
