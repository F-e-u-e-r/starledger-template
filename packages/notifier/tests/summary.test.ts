import { describe, expect, it } from 'vitest';
import { DeterministicSummaryProvider, deterministicSummary } from '../src/summary';
import { makeResolvedRepository } from './helpers';

describe('deterministicSummary', () => {
  it('uses repository metadata and never needs an LLM key', async () => {
    const repository = makeResolvedRepository({
      description: 'Useful <tool>',
      primary_language: 'Rust',
      stargazer_count: 12_345,
      topics: ['cli', 'developer-tools'],
      latest_release: {
        tag_name: 'v2.0.0',
        published_at: null,
        url: 'https://github.com/acme/widget/releases/tag/v2.0.0',
      },
    });

    const summary = await new DeterministicSummaryProvider().summarize(repository);
    expect(summary).toEqual(deterministicSummary(repository));
    expect(summary.title).toBe('acme/widget');
    expect(summary.body).toContain('Useful <tool>');
    expect(summary.body).toContain('Rust');
    expect(summary.body).toContain('12.3k stars');
    expect(summary.body).toContain('Latest v2.0.0');
    expect(summary.body).toContain('Topics: cli, developer-tools');
  });
});
