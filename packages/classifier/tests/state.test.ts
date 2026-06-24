import { describe, expect, it } from 'vitest';
import {
  ClassifierStateSchema,
  EMPTY_CLASSIFIER_STATE,
  loadClassifierState,
  serializeClassifierState,
  type ClassifierState,
} from '../src/state';
import { CLASSIFIER_STATE_BRANCH, CLASSIFIER_STATE_FILE } from '../src/state-store';

function stateWith(...repos: ClassifierState['repos']): ClassifierState {
  return { schema_version: '1.0', repos };
}

const entryA: ClassifierState['repos'][number] = {
  node_id: 'R_a',
  readme_path: 'README.md',
  readme_oid: 'o-a',
  last_fingerprint: null,
  attempts: 0,
  last_error_code: null,
  next_retry_at: null,
  terminal_unavailable: false,
};
const entryB: ClassifierState['repos'][number] = {
  node_id: 'R_b',
  readme_path: null,
  readme_oid: null,
  last_fingerprint: 'a'.repeat(64),
  attempts: 3,
  last_error_code: 'rate_limited',
  next_retry_at: '2026-06-20T00:00:00Z',
  terminal_unavailable: false,
};

describe('classifier operational state', () => {
  it('STATE-1: serialization is deterministic regardless of input order', () => {
    const bytes1 = serializeClassifierState(stateWith(entryA, entryB));
    const bytes2 = serializeClassifierState(stateWith(entryB, entryA));
    expect(bytes1).toBe(bytes2);
    expect(bytes1.endsWith('\n')).toBe(true);
    expect(serializeClassifierState(loadClassifierState(bytes1))).toBe(bytes1);
  });

  it('STATE-2: invalid remote bytes throw so the caller keeps the last-known-good', () => {
    expect(() => loadClassifierState('{not json')).toThrow();
    expect(() => loadClassifierState('{"schema_version":"9.9","repos":[]}')).toThrow();
    // a forbidden field (e.g. leaked README content) is rejected by strict()
    const leaked = JSON.stringify({
      schema_version: '1.0',
      repos: [{ ...entryA, readme_body: 'secret' }],
    });
    expect(() => loadClassifierState(leaked)).toThrow();
    // null / whitespace means cold start, not corruption
    expect(loadClassifierState(null)).toEqual(EMPTY_CLASSIFIER_STATE);
    expect(loadClassifierState('   ')).toEqual(EMPTY_CLASSIFIER_STATE);
    // a valid document parses
    const roundTripped = loadClassifierState(serializeClassifierState(stateWith(entryB)));
    expect(ClassifierStateSchema.safeParse(roundTripped).success).toBe(true);
  });

  it('STATE-3: the classifier state branch/file are dedicated and independent of the notifier', () => {
    expect(CLASSIFIER_STATE_BRANCH).toBe('starledger-ai-state');
    expect(CLASSIFIER_STATE_FILE).toBe('classifier-state.json');
    // distinct from the notifier's committed defaults, so the two writers never collide
    expect(CLASSIFIER_STATE_BRANCH).not.toBe('starledger-state');
    expect(CLASSIFIER_STATE_FILE).not.toBe('notifier-state.json');
  });
});
