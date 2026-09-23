import { describe, expect, it } from 'vitest';
import { distHasUnshippableResidue } from '../src/stage';

/**
 * RESIDUE ESCALATION DECISION (round-11 consequence; round-13 ownership).
 *
 * The CLI `stage` command exits 4 — which `pages.yml`'s `bash -e` turns into
 * "nothing ships" — when ANY stager left rejected bytes it could not remove.
 * Round-12 (sol) showed the original pin only constructed AI residue, so a
 * mutant dropping `discovery.residue` from the CLI condition passed. After the
 * round-13 ownership fix a stager reports `residue` only for its OWN
 * un-removable write, which requires a read-only dist directory that would
 * already have failed the canonical write — so an end-to-end residue can no
 * longer be constructed from a black-box subprocess. The DECISION is therefore
 * pinned here directly, over every layer position, and the stagers'
 * residue-SETTING is pinned in their own suites (optional STUCK-RESIDUE;
 * skills CLEANUP-RESIDUE / PARTIAL-TEMP; skills-source own-temp and
 * adjudicated-stale-destination, MD-9). The CLI call site passes exactly
 * `[ai, discovery, skills, skillsSource]`; that it names all four is
 * inspection-covered (K7 proves the command calls each stager), the
 * analogue of the skills-residue-not-subprocess-constructible disposition.
 */
describe('distHasUnshippableResidue', () => {
  it('is false when nothing carries residue', () => {
    expect(distHasUnshippableResidue([{}, {}, {}, {}])).toBe(false);
  });

  it.each([0, 1, 2, 3])('is true when the layer at position %i carries residue', (position) => {
    const results: Array<{ residue?: boolean }> = [{}, {}, {}, {}];
    results[position]!.residue = true;
    expect(distHasUnshippableResidue(results)).toBe(true);
  });

  it('treats only an explicit true as residue (a missing flag never escalates)', () => {
    expect(distHasUnshippableResidue([{ residue: undefined }, {}])).toBe(false);
  });
});
