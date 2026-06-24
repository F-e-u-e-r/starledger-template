// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type CanonicalRepo } from '@starred/schema';
import { deriveRepo } from '../../data/derive-fields';
import { makeRepo } from '../../test-utils';
import { RepositoryCard } from './RepositoryCard';

const NOW = new Date('2026-06-19T00:00:00Z');
const card = (over: Partial<CanonicalRepo> = {}) =>
  render(
    <ul>
      <RepositoryCard repo={deriveRepo(makeRepo(over), NOW)} />
    </ul>,
  );

afterEach(cleanup);

describe('RepositoryCard', () => {
  it('CARD-3: links to the canonical repository URL', () => {
    card({ name_with_owner: 'octocat/Hello', url: 'https://github.com/octocat/Hello' });
    expect(screen.getByRole('link', { name: 'octocat/Hello' }).getAttribute('href')).toBe(
      'https://github.com/octocat/Hello',
    );
  });

  it('CARD-1 / DATA-4: an unavailable release reads "Information unavailable", not "No release"', () => {
    card({
      hydration_status: 'failed',
      latest_stable_release: null,
      unavailable_fields: ['latest_stable_release'],
    });
    expect(screen.getByText('Information unavailable')).toBeTruthy();
    expect(screen.queryByText('No stable release')).toBeNull();
  });

  it('CARD-1: a confirmed-absent release reads "No release"', () => {
    card({ latest_stable_release: null }); // ok hydration, not unavailable → confirmed absent
    expect(screen.getByText('No stable release')).toBeTruthy();
    expect(screen.queryByText('Information unavailable')).toBeNull();
  });

  it('CARD-2: archived, fork and degraded-hydration states are visible', () => {
    card({
      is_archived: true,
      is_fork: true,
      hydration_status: 'partial',
      pushed_at: null,
      unavailable_fields: ['pushed_at'],
    });
    expect(screen.getByText('Archived')).toBeTruthy();
    expect(screen.getByText('Fork')).toBeTruthy();
    expect(screen.getByText('Partial data')).toBeTruthy();
  });

  it('CARD-4: very long name/description/topic still render in full', () => {
    const longName = 'acme/' + 'x'.repeat(120);
    card({
      name_with_owner: longName,
      url: 'https://github.com/acme/x',
      description: 'y'.repeat(400),
      topics: ['t'.repeat(60)],
    });
    expect(screen.getByRole('link', { name: longName })).toBeTruthy();
  });

  it('shows at most four topics until the overflow affordance is expanded', () => {
    card({ topics: ['one', 'two', 'three', 'four', 'five', 'six'] });
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByText('four')).toBeTruthy();
    expect(screen.queryByText('five')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    expect(screen.getByText('five')).toBeTruthy();
    expect(screen.getByText('six')).toBeTruthy();
  });

  it('moves an abbreviated star count into the card header while preserving the exact count label', () => {
    card({ stargazer_count: 103747 });
    const stars = screen.getByLabelText('103747 stars');
    expect(stars.textContent).toContain('103.7k');
  });

  it('CARD-5: colocates a prerelease-only "latest" beside the (absent) stable release', () => {
    card({
      latest_stable_release: null,
      latest_any_release: {
        tag_name: 'v2.0.0-rc1',
        published_at: '2026-05-01T00:00:00Z',
        is_prerelease: true,
      },
    });
    expect(screen.getByText('No stable release')).toBeTruthy();
    expect(screen.getByText(/^latest v2\.0\.0-rc1/)).toBeTruthy();
  });

  it('CARD-5: does not repeat "latest" when it equals the stable release', () => {
    card({
      latest_stable_release: {
        tag_name: 'v1.4.0',
        published_at: '2026-04-01T00:00:00Z',
        url: 'https://github.com/acme/base/releases/tag/v1.4.0',
      },
      latest_any_release: {
        tag_name: 'v1.4.0',
        published_at: '2026-04-01T00:00:00Z',
        is_prerelease: false,
      },
    });
    expect(screen.getByText('v1.4.0')).toBeTruthy();
    expect(screen.queryByText(/^latest/)).toBeNull();
  });
});
