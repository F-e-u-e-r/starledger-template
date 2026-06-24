import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AiConfigSchema,
  assertAiClassificationEnabled,
  DEFAULT_AI_CONFIG_PATH,
  loadAiConfig,
} from '../src/config';

describe('AiConfigSchema', () => {
  it('applies the documented defaults', () => {
    const config = AiConfigSchema.parse({});
    expect(config.ai.enabled).toBe(false);
    expect(config.ai.prompt_version).toBe('classify-v1');
    expect(config.ai.executor_kind).toBe('claude-routine');
    expect(config.ai.execution_profile.execution_profile_version).toBe('agent-v1');
    expect(config.ai.budget.max_total_per_run).toBe(25);
  });

  it('rejects unknown keys (strict)', () => {
    expect(AiConfigSchema.safeParse({ ai: { nope: true } }).success).toBe(false);
    expect(AiConfigSchema.safeParse({ whatever: 1 }).success).toBe(false);
  });

  it('bounds untrusted input and per-run budget', () => {
    expect(AiConfigSchema.safeParse({ ai: { readme_max_chars: 10 } }).success).toBe(false);
    expect(AiConfigSchema.safeParse({ ai: { budget: { max_total_per_run: 0 } } }).success).toBe(
      false,
    );
  });

  it('loads defaults when the default config file is absent', () => {
    expect(loadAiConfig(join(tmpdir(), 'starledger-no-ai-config.yaml')).ai.enabled).toBe(false);
  });

  it('loads config/ai.yaml by default when it exists', () => {
    const cwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'starledger-ai-config-'));
    try {
      mkdirSync(join(root, 'config'));
      writeFileSync(join(root, DEFAULT_AI_CONFIG_PATH), 'ai:\n  enabled: true\n', 'utf8');
      process.chdir(root);
      expect(loadAiConfig().ai.enabled).toBe(true);
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats enabled as an operational interlock', () => {
    expect(() => assertAiClassificationEnabled(AiConfigSchema.parse({}).ai)).toThrow(
      'AI classification is disabled',
    );
    expect(() =>
      assertAiClassificationEnabled(AiConfigSchema.parse({ ai: { enabled: true } }).ai),
    ).not.toThrow();
  });

  it('rejects API-provider configuration; P3.0 uses executor-neutral contracts', () => {
    expect(AiConfigSchema.safeParse({ ai: { provider: 'anthropic' } }).success).toBe(false);
    expect(AiConfigSchema.safeParse({ ai: { model: 'gpt-5.5' } }).success).toBe(false);
  });
});
