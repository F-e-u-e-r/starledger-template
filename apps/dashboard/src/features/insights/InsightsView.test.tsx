// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeAnnotation,
  makeAnnotations,
  makeRepo,
  makeSkillsClassification,
  makeSkillsRecord,
} from '../../test-utils';
import { InsightsView } from './InsightsView';

const NOW = new Date('2026-06-19T00:00:00Z');
afterEach(cleanup);

const repos = () => [
  makeRepo({
    node_id: 'R_1',
    starred_at: '2026-01-10T00:00:00Z',
    pushed_at: '2025-01-01T00:00:00Z',
  }),
  makeRepo({
    node_id: 'R_2',
    starred_at: '2026-03-10T00:00:00Z',
    pushed_at: '2026-05-01T00:00:00Z',
  }),
];
const aiAnnotations = () =>
  makeAnnotations({
    R_1: makeAnnotation({ category: 'ai-ml' }),
    R_2: makeAnnotation({ category: 'developer-tools' }),
  });

describe('M4.3a InsightsView', () => {
  it('IV-1: renders exactly the four insight cards', () => {
    render(<InsightsView repos={repos()} initialNow={NOW} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Stars by AI category' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'When you starred them' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Forgotten stars' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Skills classification coverage' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
  });

  it('IV-2: PC renders the category distribution as an accessible table when AI is coherent-ready', () => {
    render(
      <InsightsView
        repos={repos()}
        initialNow={NOW}
        annotations={aiAnnotations()}
        annotationStatus="ready"
      />,
    );
    const pc = screen
      .getByRole('heading', { level: 2, name: 'Stars by AI category' })
      .closest('section') as HTMLElement;
    // The distribution IS an accessible table (its own text/table equivalent).
    const table = within(pc).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'ai-ml' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'developer-tools' })).toBeTruthy();
    expect(screen.queryByText(/AI classification is unavailable/)).toBeNull();
  });

  it('IV-3: PC degrades when AI is unavailable (no data), coherent-ready gate', () => {
    // status ready but data null ⇒ NOT coherent-ready (F4 parity) ⇒ degraded.
    render(
      <InsightsView repos={repos()} initialNow={NOW} annotations={null} annotationStatus="ready" />,
    );
    const pc = screen
      .getByRole('heading', { level: 2, name: 'Stars by AI category' })
      .closest('section') as HTMLElement;
    expect(within(pc).getByText(/AI classification is unavailable/)).toBeTruthy();
    expect(within(pc).queryByRole('table')).toBeNull();
  });

  it('IV-4: PC shows a loading notice while AI is loading', () => {
    render(<InsightsView repos={repos()} initialNow={NOW} annotationStatus="loading" />);
    expect(screen.getByText(/AI classification is still loading/)).toBeTruthy();
  });

  it('IV-5: SA always renders, is explicitly NOT a trend, and buckets by UTC month', () => {
    render(<InsightsView repos={repos()} initialNow={NOW} />);
    const sa = screen
      .getByRole('heading', { level: 2, name: 'When you starred them' })
      .closest('section') as HTMLElement;
    expect(within(sa).getByText(/not a trend/i)).toBeTruthy();
    const table = within(sa).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: '2026-01' })).toBeTruthy();
    // zero-filled gap month is present
    expect(within(table).getByRole('rowheader', { name: '2026-02' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: '2026-03' })).toBeTruthy();
  });

  it('IV-6: ST reuses the 12-month staleness threshold and reports it in words', () => {
    render(<InsightsView repos={repos()} initialNow={NOW} />);
    const st = screen
      .getByRole('heading', { level: 2, name: 'Forgotten stars' })
      .closest('section') as HTMLElement;
    // R_1 pushed 2025-01 (~17.6mo) is stale; R_2 pushed 2026-05 is not. The 12-month
    // threshold appears in both the stat sentence and the provenance footer.
    expect(within(st).getAllByText(/over 12 months/).length).toBeGreaterThanOrEqual(1);
    expect(within(st).getByText('1', { selector: 'strong' })).toBeTruthy(); // stale count
  });

  it('IV-7: CC shows curated-subset + provenance wording when skills is coherent-ready', () => {
    const skills = makeSkillsClassification(
      { R_1: makeSkillsRecord() },
      { generatedAt: '2026-08-13T00:00:00Z' }, // default generatedAgainstStarsSha256 = 0×64
    );
    render(
      <InsightsView
        repos={repos()}
        initialNow={NOW}
        skillsClassification={skills}
        skillsStatus="ready"
        starsSha256={'f'.repeat(64)} // differs ⇒ stale
      />,
    );
    const cc = screen
      .getByRole('heading', { level: 2, name: 'Skills classification coverage' })
      .closest('section') as HTMLElement;
    expect(within(cc).getByText(/curated subset/)).toBeTruthy();
    expect(within(cc).getByText(/not classification failures/)).toBeTruthy();
    expect(within(cc).getByText(/earlier stars snapshot/)).toBeTruthy(); // provenance-stale disclosed
    // generated-layer provenance renders the generation date in the footer (F4).
    expect(within(cc).getByText(/generated 2026-08-13/)).toBeTruthy();
  });

  it('IV-8: CC degrades when the skills layer is unavailable', () => {
    render(<InsightsView repos={repos()} initialNow={NOW} skillsStatus="unavailable" />);
    const cc = screen
      .getByRole('heading', { level: 2, name: 'Skills classification coverage' })
      .closest('section') as HTMLElement;
    expect(within(cc).getByText(/Skills classification is unavailable/)).toBeTruthy();
  });

  it('IV-9: every card carries a provenance footer (explain-every-number)', () => {
    render(
      <InsightsView
        repos={repos()}
        initialNow={NOW}
        annotations={aiAnnotations()}
        annotationStatus="ready"
      />,
    );
    // one provenance line per card
    const provs = document.querySelectorAll('.insight-provenance');
    expect(provs).toHaveLength(4);
    expect(screen.getAllByText(/Coverage:/).length).toBe(4);
    // the explicit deterministic formula is rendered on every card (F3)
    expect(screen.getAllByText(/Formula:/).length).toBe(4);
  });
});
