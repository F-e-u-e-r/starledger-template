import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkAiArtifactPair,
  checkAiConfig,
  checkConfigExamples,
  checkDatasetConsistency,
  checkNodeVersion,
  checkStarsJson,
  checkStarsRead,
  checkSyncWorkflowWritePermission,
  checkTelegramBot,
  checkTelegramChat,
  checkTemplateClean,
} from '../src/checks';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'starledger-doctor-'));
  dirs.push(d);
  return d;
}
function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
}
function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
function validAiPair(annotations: unknown[] = []): { artifact: string; meta: string } {
  const artifact = JSON.stringify({ schema_version: '1.0', taxonomy_version: '1.0', annotations });
  const meta = JSON.stringify({
    schema_version: '1.0',
    annotations_sha256: sha256(artifact),
    annotation_count: annotations.length,
    taxonomy_version: '1.0',
    dataset_sha256: '0'.repeat(64),
    generated_at: '2026-01-01T00:00:00.000Z',
  });
  return { artifact, meta };
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** Fake fetch returning a fixed status + JSON body. */
function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('checkNodeVersion', () => {
  it('passes on >= 22, incomplete below', () => {
    expect(checkNodeVersion('v22.0.0').status).toBe('pass');
    expect(checkNodeVersion('v23.10.0').status).toBe('pass');
    expect(checkNodeVersion('v18.19.0').status).toBe('incomplete');
  });
});

describe('checkStarsJson', () => {
  it('absent → pass', () => {
    expect(checkStarsJson(tmp()).status).toBe('pass');
  });
  it('valid dataset → pass with count', () => {
    const d = tmp();
    write(d, 'stars.json', JSON.stringify({ schema_version: '1.0', repos: [{}, {}] }));
    const res = checkStarsJson(d);
    expect(res.status).toBe('pass');
    expect(res.detail).toContain('2 repos');
  });
  it('malformed JSON → invalid', () => {
    const d = tmp();
    write(d, 'stars.json', '{not json');
    expect(checkStarsJson(d).status).toBe('invalid');
  });
  it('wrong shape → invalid', () => {
    const d = tmp();
    write(d, 'stars.json', JSON.stringify({ schema_version: '1.0' }));
    expect(checkStarsJson(d).status).toBe('invalid');
  });
});

describe('checkDatasetConsistency', () => {
  it('agreeing counts → pass', () => {
    const d = tmp();
    const stars = JSON.stringify({ schema_version: '1.0', repos: [{}, {}, {}] });
    write(d, 'stars.json', stars);
    write(d, 'dataset-meta.json', JSON.stringify({ stars_sha256: sha256(stars), repo_count: 3 }));
    expect(checkDatasetConsistency(d).status).toBe('pass');
  });
  it('mismatched counts → invalid', () => {
    const d = tmp();
    const stars = JSON.stringify({ schema_version: '1.0', repos: [{}, {}, {}] });
    write(d, 'stars.json', stars);
    write(d, 'dataset-meta.json', JSON.stringify({ stars_sha256: sha256(stars), repo_count: 2 }));
    expect(checkDatasetConsistency(d).status).toBe('invalid');
  });
  it('only one of the pair → invalid', () => {
    const d = tmp();
    write(d, 'stars.json', JSON.stringify({ repos: [] }));
    expect(checkDatasetConsistency(d).status).toBe('invalid');
  });
});

describe('checkAiConfig', () => {
  it('absent → pass', () => {
    expect(checkAiConfig(tmp()).status).toBe('pass');
  });
  it('enabled:false → pass', () => {
    const d = tmp();
    write(d, 'config/ai.yaml', 'ai:\n  enabled: false\n');
    expect(checkAiConfig(d).status).toBe('pass');
  });
  it('enabled:true with valid executor → pass', () => {
    const d = tmp();
    write(d, 'config/ai.yaml', 'ai:\n  enabled: true\n  executor_kind: claude-routine\n');
    expect(checkAiConfig(d).status).toBe('pass');
  });
  it('enabled:true with bad executor → invalid', () => {
    const d = tmp();
    write(d, 'config/ai.yaml', 'ai:\n  enabled: true\n  executor_kind: rogue-bot\n');
    expect(checkAiConfig(d).status).toBe('invalid');
  });
  it('enabled:true with non-positive budget → invalid', () => {
    const d = tmp();
    write(
      d,
      'config/ai.yaml',
      'ai:\n  enabled: true\n  executor_kind: claude-routine\n  budget:\n    max_total_per_run: 0\n',
    );
    expect(checkAiConfig(d).status).toBe('invalid');
  });
});

describe('checkAiArtifactPair', () => {
  it('neither present → pass', () => {
    expect(checkAiArtifactPair(tmp()).status).toBe('pass');
  });
  it('annotations without meta → invalid', () => {
    const d = tmp();
    write(d, 'ai-annotations.json', JSON.stringify({ annotations: [] }));
    expect(checkAiArtifactPair(d).status).toBe('invalid');
  });
  it('count mismatch → invalid', () => {
    const d = tmp();
    const { artifact, meta } = validAiPair([{}, {}]);
    write(d, 'ai-annotations.json', artifact);
    write(
      d,
      'ai-annotations-meta.json',
      meta.replace('"annotation_count":2', '"annotation_count":5'),
    );
    expect(checkAiArtifactPair(d).status).toBe('invalid');
  });
  it('consistent pair → pass', () => {
    const d = tmp();
    const { artifact, meta } = validAiPair([{}, {}]);
    write(d, 'ai-annotations.json', artifact);
    write(d, 'ai-annotations-meta.json', meta);
    expect(checkAiArtifactPair(d).status).toBe('pass');
  });
});

describe('checkConfigExamples', () => {
  it('missing examples → incomplete', () => {
    expect(checkConfigExamples(tmp()).status).toBe('incomplete');
  });
  it('all examples present → pass', () => {
    const d = tmp();
    for (const f of [
      'config.example.yaml',
      'config/ai.example.yaml',
      'config/notifier.example.yaml',
      'config/template.example.yaml',
    ]) {
      write(d, f, '# example\n');
    }
    expect(checkConfigExamples(d).status).toBe('pass');
  });
});

describe('checkSyncWorkflowWritePermission', () => {
  it('passes when sync-stars requests contents write', () => {
    const d = tmp();
    write(d, '.github/workflows/sync-stars.yml', 'permissions:\n  contents: write\n');
    expect(checkSyncWorkflowWritePermission(d).status).toBe('pass');
  });

  it('rejects a sync workflow without contents write', () => {
    const d = tmp();
    write(d, '.github/workflows/sync-stars.yml', 'permissions:\n  contents: read\n');
    expect(checkSyncWorkflowWritePermission(d).status).toBe('invalid');
  });
});

describe('checkTemplateClean', () => {
  it('pristine dir → all pass', () => {
    const out = checkTemplateClean(tmp());
    expect(out.every((r) => r.status === 'pass')).toBe(true);
  });
  it('personal artifact present → invalid', () => {
    const d = tmp();
    write(d, 'stars.json', '{"repos":[]}');
    const out = checkTemplateClean(d);
    expect(out.find((r) => r.id === 'clean.personal-artifacts')?.status).toBe('invalid');
  });
  it('live config present → invalid', () => {
    const d = tmp();
    write(d, 'config/ai.yaml', 'ai:\n  enabled: true\n');
    const out = checkTemplateClean(d);
    expect(out.find((r) => r.id === 'clean.live-config')?.status).toBe('invalid');
  });
  it('environment file present → invalid', () => {
    const d = tmp();
    write(d, '.env.staging', 'SECRET=never-ship\n');
    const out = checkTemplateClean(d);
    expect(out.find((r) => r.id === 'clean.env-files')?.status).toBe('invalid');
  });
});

describe('network checks (injected fetch)', () => {
  it('stars read: 401 → invalid', async () => {
    const res = await checkStarsRead('t', fakeFetch(401, {}));
    expect(res.status).toBe('invalid');
  });
  it('stars read: ok with login → pass', async () => {
    const res = await checkStarsRead(
      't',
      fakeFetch(200, {
        data: { viewer: { login: 'octocat', starredRepositories: { totalCount: 7 } } },
      }),
    );
    expect(res.status).toBe('pass');
    expect(res.detail).toContain('octocat');
  });
  it('stars read: 500 → warn (transient)', async () => {
    const res = await checkStarsRead('t', fakeFetch(500, {}));
    expect(res.status).toBe('warn');
  });
  it('telegram: 401 → invalid', async () => {
    const res = await checkTelegramBot(
      't',
      '1',
      fakeFetch(401, { ok: false, description: 'Unauthorized' }),
    );
    expect(res.status).toBe('invalid');
  });
  it('telegram: ok → pass', async () => {
    const res = await checkTelegramBot(
      't',
      '1',
      fakeFetch(200, { ok: true, result: { username: 'mybot' } }),
    );
    expect(res.status).toBe('pass');
    expect(res.detail).toContain('mybot');
  });
  it('telegram destination: inaccessible chat → invalid without sending', async () => {
    const res = await checkTelegramChat(
      't',
      '-1001',
      fakeFetch(403, { ok: false, description: 'Forbidden' }),
    );
    expect(res.status).toBe('invalid');
  });
});
