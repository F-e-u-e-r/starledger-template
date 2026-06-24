import { z } from 'zod';

/**
 * The taxonomy version. Bump this whenever the category set, the tag vocabulary,
 * or the classification limits below change in a way that should invalidate
 * existing annotations (it is a component of the source fingerprint in P3.1).
 * It is a string, mirroring `schema_version`, so it can grow to "1.1", "2", etc.
 */
export const TAXONOMY_VERSION = '1';

/**
 * The single PRIMARY category. Exactly one is assigned per repository. This is a
 * CLOSED set: an executor candidate may never return a value outside it (enforced by
 * `CategorySchema`). `other` is the deliberate escape hatch so a repository is
 * never forced into a wrong bucket.
 */
export const CATEGORIES = [
  'ai-ml',
  'communication-collaboration',
  'data-analytics',
  'developer-tools',
  'devops-infrastructure',
  'education-reference',
  'libraries-frameworks',
  'media-creative',
  'mobile',
  'other',
  'productivity-automation',
  'security-privacy',
  'self-hosted-homelab',
  'web-applications',
] as const;

export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/**
 * The CONTROLLED tag vocabulary (multi-label). Tags are cross-cutting facets,
 * deliberately NOT a duplicate of canonical fields the dashboard already has
 * (primary language, topics, stars). v1 is a closed list: arbitrary free-form
 * tags are rejected, so the facet space stays bounded and stable. Keep this list
 * sorted and unique — `TagSchema` and the annotation contract assume canonical
 * (sorted, deduplicated) tag arrays.
 */
export const TAGS = [
  'ai-agents',
  'api',
  'authentication',
  'automation',
  'awesome-list',
  'backend',
  'backup',
  'benchmark',
  'boilerplate',
  'bot',
  'build-tool',
  'caching',
  'cli',
  'cms',
  'code-generation',
  'configuration',
  'containers',
  'dashboard',
  'database',
  'deployment',
  'desktop-app',
  'documentation',
  'editor',
  'encryption',
  'etl',
  'frontend',
  'game',
  'graphql',
  'gui',
  'kubernetes',
  'library',
  'linter',
  'llm',
  'logging',
  'machine-learning',
  'markdown',
  'message-queue',
  'monitoring',
  'networking',
  'no-code',
  'notifications',
  'observability',
  'orchestration',
  'orm',
  'package-manager',
  'plugin',
  'productivity',
  'proxy',
  'real-time',
  'rest-api',
  'scraping',
  'sdk',
  'search',
  'security-scanner',
  'self-hosted',
  'serverless',
  'static-site-generator',
  'terminal',
  'testing',
  'theme',
  'tui',
  'vector-database',
  'visualization',
  'web-framework',
  'workflow',
] as const;

export const TagSchema = z.enum(TAGS);
export type Tag = z.infer<typeof TagSchema>;

/** Classification limits (part of the versioned taxonomy contract). */
export const MAX_TAGS = 6;
export const TAG_MAX_LENGTH = 32;
export const SUMMARY_MIN_LENGTH = 80;
export const SUMMARY_MAX_LENGTH = 400;

/**
 * Deterministically canonicalize a raw tag list: deduplicate and sort ascending.
 * It does NOT validate membership (that is `TagSchema`'s job) — it only puts a
 * agent candidate tags into the one canonical order the annotation contract accepts,
 * so duplicate/unordered model output normalizes instead of failing.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
