import { describe, expect, it } from 'vitest';
import { neutralizeSchedule } from '../src/workflows';

const SCHEDULED = `name: Sync stars
on:
  schedule:
    # Non-zero minute (avoid the top-of-hour stampede).
    - cron: '23 5 * * *'
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
`;

describe('neutralizeSchedule', () => {
  it('comments out the schedule, keeps workflow_dispatch, preserves the cron', () => {
    const { text, changed } = neutralizeSchedule(SCHEDULED);
    expect(changed).toBe(true);
    // No uncommented top-level `schedule:` key remains.
    expect(/^ {2}schedule:/m.test(text)).toBe(false);
    // workflow_dispatch survives as the only live trigger.
    expect(text.includes('workflow_dispatch:')).toBe(true);
    // The original cron is retained as a comment for deliberate re-enable.
    expect(text.includes('# schedule:')).toBe(true);
    expect(text.includes("cron: '23 5 * * *'")).toBe(true);
    // The job body is untouched.
    expect(text.includes('runs-on: ubuntu-latest')).toBe(true);
  });

  it('is a no-op for a workflow without a schedule', () => {
    const wf = `name: CI
on:
  pull_request:
  workflow_dispatch:
`;
    const { text, changed } = neutralizeSchedule(wf);
    expect(changed).toBe(false);
    expect(text).toBe(wf);
  });
});
