// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataLoadError } from '../data/load-stars';
import { makeDataset, makeRepo } from '../test-utils';
import { App } from './App';

afterEach(cleanup);

describe('App state machine', () => {
  it('DATA-1: renders verified repositories', async () => {
    render(
      <App
        loader={async () => makeDataset([makeRepo({ node_id: 'R_1', name_with_owner: 'a/one' })])}
      />,
    );
    await waitFor(() => expect(screen.getByText('a/one')).toBeTruthy());
    expect(screen.getByText('1 of 1 repositories')).toBeTruthy();
  });

  it('EMPTY-1: shows an empty state for zero repos (not an error)', async () => {
    render(<App loader={async () => makeDataset([])} />);
    await waitFor(() => expect(screen.getByText('No starred repositories yet.')).toBeTruthy());
  });

  it('DATA-3: an integrity failure renders an error and no repositories', async () => {
    render(
      <App
        loader={async () => {
          throw new DataLoadError('sha mismatch', 'integrity');
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText('Data integrity check failed')).toBeTruthy());
    expect(screen.queryByText('repositories')).toBeNull();
  });
});
