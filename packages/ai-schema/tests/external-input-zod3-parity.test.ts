import { describe, expect, it } from 'vitest';
import { UtcTimestampSchema } from '../src/scalars';
import { ClassificationCandidateSchema } from '../src/candidate';
import { ClassificationJobSchema } from '../src/job';
import { AiAnnotationsSchema } from '../src/artifact';

// Zod 3 -> Zod 4 parity oracle for UNCHANGED external-input schemas. Expected values were
// captured by running these exact inputs under zod@3.25.76 (the pre-migration contract):
// accept/reject, the stored output for accepted inputs (no trimming or rewriting), and the
// set of issue paths for rejected inputs. Issue codes and messages are Zod's own naming and
// are deliberately not asserted. Inputs whose outcome Zod 4 changed on purpose (safe-integer
// `.int()`, the early size-bound rejection of GHSA-mrhx-c7xc-m3w5) are disclosed in the PR
// instead of being pinned here.
describe('UtcTimestampSchema parity with zod@3.25.76 (ai-schema.UtcTimestampSchema)', () => {
  it('seconds-Z: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2026-10-27T10:00:00Z');
  });

  it('fraction-Z: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00.123Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2026-10-27T10:00:00.123Z');
  });

  it('fraction-long-Z: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00.123456789Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2026-10-27T10:00:00.123456789Z');
  });

  it('minutes-only-Z: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2026-10-27T10:00Z');
  });

  it('offset-colon: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00+00:00');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('offset-nocolon: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00+0000');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('offset-hhonly: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00+01');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('offset-out-of-range: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00+99:99');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('no-offset: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('lowercase-z: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('space-separator: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27 10:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('leap-day-valid: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2028-02-29T00:00:00Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2028-02-29T00:00:00Z');
  });

  it('leap-day-invalid: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2027-02-29T00:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('month-13: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-13-01T00:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('hour-24: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T24:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('second-60: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:60Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('day-31-april: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-04-31T00:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('trailing-space: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00Z ');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('year-5digit: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('12026-10-27T10:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('empty: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});

describe('ClassificationCandidateSchema parity with zod@3.25.76 (ai-schema.ClassificationCandidateSchema)', () => {
  it('helper-candidate: accepted with the Zod 3 output', () => {
    const result = ClassificationCandidateSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      category: 'developer-tools',
      tags: ['automation', 'cli'],
      summary:
        'A concise, factual description of this repository that remains within the documented summary bounds for the public artifact.',
      execution: {
        kind: 'claude-routine',
        profile_version: 'agent-v1',
        model_label: 'informational-only',
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      category: 'developer-tools',
      tags: ['automation', 'cli'],
      summary:
        'A concise, factual description of this repository that remains within the documented summary bounds for the public artifact.',
      execution: {
        kind: 'claude-routine',
        profile_version: 'agent-v1',
        model_label: 'informational-only',
      },
    });
  });

  it('extra-key: rejected at the same paths as Zod 3', () => {
    const result = ClassificationCandidateSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      category: 'developer-tools',
      tags: ['automation', 'cli'],
      summary:
        'A concise, factual description of this repository that remains within the documented summary bounds for the public artifact.',
      execution: {
        kind: 'claude-routine',
        profile_version: 'agent-v1',
        model_label: 'informational-only',
      },
      extra: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('tags-not-array: rejected at the same paths as Zod 3', () => {
    const result = ClassificationCandidateSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      category: 'developer-tools',
      tags: 'x',
      summary:
        'A concise, factual description of this repository that remains within the documented summary bounds for the public artifact.',
      execution: {
        kind: 'claude-routine',
        profile_version: 'agent-v1',
        model_label: 'informational-only',
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['tags']);
  });

  it('tags-bad-element: rejected at the same paths as Zod 3', () => {
    const result = ClassificationCandidateSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      category: 'developer-tools',
      tags: ['Bad Tag!'],
      summary:
        'A concise, factual description of this repository that remains within the documented summary bounds for the public artifact.',
      execution: {
        kind: 'claude-routine',
        profile_version: 'agent-v1',
        model_label: 'informational-only',
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['tags.0']);
  });

  it('summary-number: rejected at the same paths as Zod 3', () => {
    const result = ClassificationCandidateSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      category: 'developer-tools',
      tags: ['automation', 'cli'],
      summary: 5,
      execution: {
        kind: 'claude-routine',
        profile_version: 'agent-v1',
        model_label: 'informational-only',
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['summary']);
  });

  it('summary-empty: rejected at the same paths as Zod 3', () => {
    const result = ClassificationCandidateSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      category: 'developer-tools',
      tags: ['automation', 'cli'],
      summary: '',
      execution: {
        kind: 'claude-routine',
        profile_version: 'agent-v1',
        model_label: 'informational-only',
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['summary']);
  });

  it('null-input: rejected at the same paths as Zod 3', () => {
    const result = ClassificationCandidateSchema.safeParse(null);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});

describe('ClassificationJobSchema parity with zod@3.25.76 (ai-schema.ClassificationJobSchema)', () => {
  it('helper-job: accepted with the Zod 3 output', () => {
    const result = ClassificationJobSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      executor_kind: 'claude-routine',
      input: {
        name_with_owner: 'example/repository',
        description: 'A repository used to test deterministic agent contracts.',
        primary_language: 'TypeScript',
        topics: ['automation', 'testing'],
        repo_metadata_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        readme: {
          path: 'README.md',
          oid: 'abc123def456',
          content: 'This is bounded, untrusted README content for a test repository.',
        },
      },
      constraints: {
        allowed_categories: [
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
        ],
        allowed_tags: [
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
        ],
        max_tags: 6,
        summary_min_chars: 80,
        summary_max_chars: 400,
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      executor_kind: 'claude-routine',
      input: {
        name_with_owner: 'example/repository',
        description: 'A repository used to test deterministic agent contracts.',
        primary_language: 'TypeScript',
        topics: ['automation', 'testing'],
        repo_metadata_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        readme: {
          path: 'README.md',
          oid: 'abc123def456',
          content: 'This is bounded, untrusted README content for a test repository.',
        },
      },
      constraints: {
        allowed_categories: [
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
        ],
        allowed_tags: [
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
        ],
        max_tags: 6,
        summary_min_chars: 80,
        summary_max_chars: 400,
      },
    });
  });

  it('extra-key: rejected at the same paths as Zod 3', () => {
    const result = ClassificationJobSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      executor_kind: 'claude-routine',
      input: {
        name_with_owner: 'example/repository',
        description: 'A repository used to test deterministic agent contracts.',
        primary_language: 'TypeScript',
        topics: ['automation', 'testing'],
        repo_metadata_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        readme: {
          path: 'README.md',
          oid: 'abc123def456',
          content: 'This is bounded, untrusted README content for a test repository.',
        },
      },
      constraints: {
        allowed_categories: [
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
        ],
        allowed_tags: [
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
        ],
        max_tags: 6,
        summary_min_chars: 80,
        summary_max_chars: 400,
      },
      extra: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('input-topics-unsorted: rejected at the same paths as Zod 3', () => {
    const result = ClassificationJobSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      executor_kind: 'claude-routine',
      input: {
        name_with_owner: 'example/repository',
        description: 'A repository used to test deterministic agent contracts.',
        primary_language: 'TypeScript',
        topics: ['b', 'a'],
        repo_metadata_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        readme: {
          path: 'README.md',
          oid: 'abc123def456',
          content: 'This is bounded, untrusted README content for a test repository.',
        },
      },
      constraints: {
        allowed_categories: [
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
        ],
        allowed_tags: [
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
        ],
        max_tags: 6,
        summary_min_chars: 80,
        summary_max_chars: 400,
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['input', 'job_id']);
  });

  it('input-topics-duplicate: rejected at the same paths as Zod 3', () => {
    const result = ClassificationJobSchema.safeParse({
      schema_version: '1.0',
      job_id: 'sha256:28871e3029cb3ef9ccf1dcdef4fbe97b487cbed6be6df1086208fff0b8d1e5bd',
      node_id: 'R_kgDOAAA',
      source_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      taxonomy_version: '1',
      prompt_version: 'classify-v1',
      execution_profile_version: 'agent-v1',
      executor_kind: 'claude-routine',
      input: {
        name_with_owner: 'example/repository',
        description: 'A repository used to test deterministic agent contracts.',
        primary_language: 'TypeScript',
        topics: ['a', 'a'],
        repo_metadata_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        readme: {
          path: 'README.md',
          oid: 'abc123def456',
          content: 'This is bounded, untrusted README content for a test repository.',
        },
      },
      constraints: {
        allowed_categories: [
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
        ],
        allowed_tags: [
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
        ],
        max_tags: 6,
        summary_min_chars: 80,
        summary_max_chars: 400,
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['input', 'job_id']);
  });

  it('null-input: rejected at the same paths as Zod 3', () => {
    const result = ClassificationJobSchema.safeParse(null);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});

describe('AiAnnotationsSchema parity with zod@3.25.76 (ai-schema.AiAnnotationsSchema)', () => {
  it('helper-document: accepted with the Zod 3 output', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
  });

  it('two-sorted-by-builder: accepted with the Zod 3 output', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_a',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
        {
          node_id: 'R_b',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_a',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
        {
          node_id: 'R_b',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
  });

  it('empty-annotations: accepted with the Zod 3 output', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [],
    });
  });

  it('extra-key: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
      extra: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('bad-schema-version: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '2.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['schema_version']);
  });

  it('unsorted-annotations: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_b',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
        {
          node_id: 'R_a',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations']);
  });

  it('duplicate-node-id: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_a',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
        {
          node_id: 'R_a',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations']);
  });

  it('tags-unsorted: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['cli', 'automation'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations.0.tags']);
  });

  it('tags-duplicate: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['cli', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations.0.tags']);
  });

  it('tags-not-array: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: 'cli',
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations.0.tags']);
  });

  it('summary-empty: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary: '',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations.0.summary']);
  });

  it('category-unknown: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'not-a-category',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations.0.category']);
  });

  it('generated-at-minutes-only: accepted with the Zod 3 output', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00Z',
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00Z',
          },
        },
      ],
    });
  });

  it('generated-at-fraction: accepted with the Zod 3 output', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00.5Z',
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00.5Z',
          },
        },
      ],
    });
  });

  it('generated-at-offset-rejected: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00+00:00',
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations.0.generation.generated_at']);
  });

  it('generated-at-not-string: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: 5,
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations.0.generation.generated_at']);
  });

  it('annotation-extra-key: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [
        {
          node_id: 'R_kgDOAAA',
          category: 'developer-tools',
          tags: ['automation', 'cli'],
          summary:
            'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
          source: {
            kind: 'readme',
            readme_path: 'README.md',
            readme_oid: 'abc123def456',
            repo_metadata_sha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          generation: {
            executor_kind: 'claude-routine',
            execution_profile_version: 'agent-v1',
            model_label: 'informational-only',
            prompt_version: 'classify-v1',
            generated_at: '2026-06-20T00:00:00Z',
          },
          extra: true,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations.0']);
  });

  it('annotations-not-array: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: {},
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['annotations']);
  });

  it('null-input: rejected at the same paths as Zod 3', () => {
    const result = AiAnnotationsSchema.safeParse(null);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});
