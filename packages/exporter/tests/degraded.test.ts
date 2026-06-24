import { CanonicalRepoSchema, HYDRATABLE_FIELDS } from '@starred/schema';
import { describe, expect, it } from 'vitest';
import { evaluateDegraded } from '../src/degraded';
import { buildFailedRecord, mergeSeeds } from '../src/hydrate';
import { makeRawNode, makeSeed } from './helpers';

describe('degraded gate (DEG-1..7)', () => {
  it('DEG-1: ratio 0 → publishable, not degraded', () => {
    const d = evaluateDegraded(0, 100, 0.05);
    expect(d.withinThreshold).toBe(true);
    expect(d.degraded).toBe(false);
    expect(d.degradedRatio).toBe(0);
  });

  it('DEG-2: ratio exactly at the threshold → publishable AND degraded', () => {
    const d = evaluateDegraded(5, 100, 0.05);
    expect(d.withinThreshold).toBe(true);
    expect(d.degraded).toBe(true);
  });

  it('DEG-3: ratio just over the threshold → not publishable', () => {
    const d = evaluateDegraded(501, 10000, 0.05);
    expect(d.withinThreshold).toBe(false);
  });

  it('DEG-4: a failed record keeps identity, lists all hydratable fields, and is schema-valid', () => {
    const rec = buildFailedRecord(makeSeed('R_x', '2026-05-01T00:00:00Z'));
    expect(rec.hydration_status).toBe('failed');
    expect(rec.name_with_owner).toBe('acme/R_x');
    expect(rec.url).toBe('https://github.com/acme/R_x');
    expect([...rec.unavailable_fields].sort()).toEqual([...HYDRATABLE_FIELDS].sort());
    expect(CanonicalRepoSchema.safeParse(rec).success).toBe(true);
  });

  it('DEG-5/DEG-6: removed_mid_run is NOT a hydration failure', () => {
    const merged = mergeSeeds(
      [makeSeed('R_ok', '2026-05-01T00:00:00Z'), makeSeed('R_gone', '2026-04-01T00:00:00Z')],
      {
        nodesById: new Map([['R_ok', makeRawNode({ id: 'R_ok', nameWithOwner: 'a/ok' })]]),
        nullNodeIds: ['R_gone'],
        failedNodeIds: [],
      },
    );
    expect(merged.failedRecords).toHaveLength(0);
    expect(merged.removedMidRun).toBe(1);
  });

  it('DEG-7: a failed node without identity is dropped, not published', () => {
    const merged = mergeSeeds(
      [makeSeed('R_x', '2026-05-01T00:00:00Z', { name_with_owner: null, url: null })],
      { nodesById: new Map(), nullNodeIds: [], failedNodeIds: ['R_x'] },
    );
    expect(merged.failedRecords).toHaveLength(0);
    expect(merged.droppedUnidentifiable).toBe(1);
  });
});
