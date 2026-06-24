import { describe, expect, it } from 'vitest';
import { makeRepo } from '../../test-utils';
import { matchesQuery } from './search';

const repo = makeRepo({
  name_with_owner: 'octocat/Hello-World',
  description: 'My first repository',
  topics: ['demo', 'tutorial'],
  primary_language: 'Ruby',
});

describe('matchesQuery (SEARCH-1 / SEARCH-2)', () => {
  it('SEARCH-1: matches name, description, topic, and language', () => {
    expect(matchesQuery(repo, 'hello-world')).toBe(true);
    expect(matchesQuery(repo, 'first repository')).toBe(true);
    expect(matchesQuery(repo, 'tutorial')).toBe(true);
    expect(matchesQuery(repo, 'ruby')).toBe(true);
    expect(matchesQuery(repo, 'python')).toBe(false);
  });

  it('SEARCH-2: case-insensitive; empty/whitespace query matches all', () => {
    expect(matchesQuery(repo, 'HELLO')).toBe(true);
    expect(matchesQuery(repo, '')).toBe(true);
    expect(matchesQuery(repo, '   ')).toBe(true);
  });
});
