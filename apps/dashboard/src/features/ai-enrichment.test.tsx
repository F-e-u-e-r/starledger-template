// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveAll, deriveRepo } from '../data/derive-fields';
import {
  DEFAULT_DASHBOARD_STATE,
  parseDashboardState,
  serializeDashboardState,
} from '../state/dashboard-state';
import { makeAnnotation, makeAnnotations, makeRepo } from '../test-utils';
import { EMPTY_FILTERS, applyFilters } from './filters/filters';
import { RepositoryCard } from './repositories/RepositoryCard';
import { RepositoryView } from './repositories/RepositoryView';
import { deriveFacetOptions, prepareRepositories } from './repositories/select';
import { buildSearchText, matchesSearchText } from './search/search';

const NOW = new Date('2026-06-19T00:00:00Z');

afterEach(cleanup);

describe('AI join (P3.4)', () => {
  it('JOIN-1 / JOIN-3: annotations join by node_id; unannotated repos stay visible', () => {
    const repos = [makeRepo({ node_id: 'R_1' }), makeRepo({ node_id: 'R_2' })];
    const derived = deriveAll(repos, NOW, new Map([['R_1', makeAnnotation()]]));
    expect(derived.find((r) => r.node_id === 'R_1')?.ai?.category).toBe('developer-tools');
    expect(derived.find((r) => r.node_id === 'R_2')?.ai).toBeNull(); // visible, just no AI
    expect(derived).toHaveLength(2);
  });

  it('JOIN-2: an orphan annotation (node_id not in the dataset) is ignored', () => {
    const derived = deriveAll(
      [makeRepo({ node_id: 'R_1' })],
      NOW,
      new Map([['R_ghost', makeAnnotation()]]),
    );
    expect(derived).toHaveLength(1);
    expect(derived[0]?.ai).toBeNull();
  });

  it('JOIN-4: AI never overrides canonical fields', () => {
    const repo = makeRepo({
      node_id: 'R_1',
      description: 'Canonical GitHub description',
      primary_language: 'Rust',
    });
    const derived = deriveRepo(repo, NOW, makeAnnotation({ summary: 'AI summary' }));
    expect(derived.description).toBe('Canonical GitHub description');
    expect(derived.primary_language).toBe('Rust');
    expect(derived.ai?.summary).toBe('AI summary');
  });
});

describe('AI facets, filters, search (P3.4)', () => {
  const repos = [
    makeRepo({ node_id: 'R_1', name_with_owner: 'a/one' }),
    makeRepo({ node_id: 'R_2', name_with_owner: 'a/two' }),
  ];
  const annotations = new Map([
    ['R_1', makeAnnotation({ category: 'ai-ml', tags: ['llm', 'cli'] })],
    ['R_2', makeAnnotation({ category: 'developer-tools', tags: ['cli'] })],
  ]);
  const prepared = prepareRepositories(repos, NOW, annotations);

  it('AI facet options derive from annotations only (sorted, unique)', () => {
    const facets = deriveFacetOptions(prepared);
    expect(facets.categories).toEqual(['ai-ml', 'developer-tools']);
    expect(facets.aiTags).toEqual(['cli', 'llm']);
    expect(deriveFacetOptions(prepareRepositories(repos, NOW)).categories).toEqual([]);
  });

  it('UI-1: the category filter narrows to a single category', () => {
    const out = applyFilters(prepared, { ...EMPTY_FILTERS, categories: ['ai-ml'] });
    expect(out.map((r) => r.node_id)).toEqual(['R_1']);
  });

  it('UI-2: AI tags are OR-within the facet (any selected tag matches)', () => {
    expect(
      applyFilters(prepared, { ...EMPTY_FILTERS, aiTags: ['llm'] }).map((r) => r.node_id),
    ).toEqual(['R_1']);
    expect(
      applyFilters(prepared, { ...EMPTY_FILTERS, aiTags: ['cli'] })
        .map((r) => r.node_id)
        .sort(),
    ).toEqual(['R_1', 'R_2']);
  });

  it('UI-2: a repo without an annotation cannot match an AI facet', () => {
    const unannotated = prepareRepositories([makeRepo({ node_id: 'R_x' })], NOW);
    expect(applyFilters(unannotated, { ...EMPTY_FILTERS, categories: ['ai-ml'] })).toHaveLength(0);
  });

  it('UI-4: AI category, tags, and summary are searchable', () => {
    const text = buildSearchText(prepared[0]!);
    expect(matchesSearchText(text, 'ai-ml')).toBe(true);
    expect(matchesSearchText(text, 'llm')).toBe(true);
    expect(matchesSearchText(text, 'summary')).toBe(true);
  });
});

describe('AI URL state (P3.4)', () => {
  it('UI-3: category and aiTag round-trip through the URL, sorted + deduplicated', () => {
    const state = parseDashboardState(
      new URLSearchParams('category=ai-ml&aiTag=llm&aiTag=cli&aiTag=cli'),
    );
    expect(state.categories).toEqual(['ai-ml']);
    expect(state.aiTags).toEqual(['cli', 'llm']);
    expect(parseDashboardState(new URLSearchParams(serializeDashboardState(state)))).toEqual(state);
    expect(serializeDashboardState(DEFAULT_DASHBOARD_STATE)).toBe('');
  });
});

describe('AI card + coverage (P3.4)', () => {
  const cardOf = (annotation: Parameters<typeof deriveRepo>[2]) =>
    render(
      <ul>
        <RepositoryCard
          repo={deriveRepo(makeRepo({ node_id: 'R_1' }), NOW, annotation)}
          now={NOW}
        />
      </ul>,
    );

  it('UI-5: an annotated card shows the AI-generated marker, category, summary, and tags', () => {
    cardOf(makeAnnotation({ category: 'ai-ml', tags: ['llm'], summary: 'A helpful AI summary.' }));
    expect(screen.getByText('ai-ml')).toBeTruthy();
    expect(screen.getByText('A helpful AI summary.')).toBeTruthy();
    expect(screen.getByText('llm')).toBeTruthy();
    expect(screen.getByText(/AI-generated/)).toBeTruthy();
  });

  it('UI-6: an unannotated card renders no AI block', () => {
    cardOf(null);
    expect(screen.queryByText(/AI-generated/)).toBeNull();
  });

  it('UI-7: coverage count is accurate; absent AI renders fail-soft with no count', () => {
    const repos = [makeRepo({ node_id: 'R_1' }), makeRepo({ node_id: 'R_2' })];
    const { rerender } = render(<RepositoryView repos={repos} initialNow={NOW} />);
    expect(screen.queryByText(/AI-enriched/)).toBeNull(); // fail-soft: still renders, no AI count
    expect(screen.getByText(/2 starred repositories/)).toBeTruthy();

    rerender(
      <RepositoryView
        repos={repos}
        initialNow={NOW}
        annotations={makeAnnotations({ R_1: makeAnnotation() })}
      />,
    );
    expect(screen.getByText(/1 of 2 AI-enriched/)).toBeTruthy();
  });
});
