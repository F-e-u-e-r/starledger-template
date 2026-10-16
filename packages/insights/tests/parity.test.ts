import { describe, expect, it } from 'vitest';
import {
  type InsightRepo,
  type InsightSkillsSummary,
  computeCategoryDistribution,
  computeClassificationCoverage,
  computeStaleStars,
  computeStarringActivity,
} from '../src/index';
import golden from './parity.golden.json';

// M4.3b.1 EXTRACTION PARITY GATE. `parity.golden.json` was captured by running the
// PRE-extraction, dashboard-local implementation on a fixed fixture. This asserts
// the POST-extraction shared implementation produces byte-identical outputs on the
// SAME input — the extraction is behavior-preserving, not "the old tests still
// pass". If either implementation's output drifts, this fails.
describe('M4.3b.1 — shared-core extraction parity (pre == post)', () => {
  const fixture = golden.fixture as unknown as InsightRepo[];
  const skills = golden.skillsSummary as unknown as InsightSkillsSummary;

  it('PC — computeCategoryDistribution deep-equals the pre-extraction output', () => {
    expect(computeCategoryDistribution(fixture, golden.generatedAt)).toEqual(golden.expected.pc);
  });

  it('SA — computeStarringActivity deep-equals the pre-extraction output', () => {
    expect(computeStarringActivity(fixture)).toEqual(golden.expected.sa);
  });

  it('ST — computeStaleStars deep-equals the pre-extraction output', () => {
    expect(computeStaleStars(fixture)).toEqual(golden.expected.st);
  });

  it('CC — computeClassificationCoverage deep-equals the pre-extraction output', () => {
    expect(computeClassificationCoverage(fixture, skills, golden.currentStarsSha256)).toEqual(
      golden.expected.cc,
    );
  });
});
