import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const ManualEntrySchema = z
  .object({
    url: z.string().min(1),
    note: z.string().optional(),
  })
  .strict();

export const DiscoveryInboxConfigSchema = z
  .object({
    manual: z.array(ManualEntrySchema).default([]),
  })
  .strict();
export type DiscoveryInboxConfig = z.infer<typeof DiscoveryInboxConfigSchema>;

export interface ManualEntry {
  url: string;
  note?: string;
}

const DecisionEntrySchema = z
  .object({
    repo: z.string().min(1),
    reason: z.string().optional(),
  })
  .strict();

export const DiscoveryDecisionsConfigSchema = z
  .object({
    dismissed: z.array(DecisionEntrySchema).default([]),
    promoted: z.array(DecisionEntrySchema).default([]),
  })
  .strict();
export type DiscoveryDecisionsConfig = z.infer<typeof DiscoveryDecisionsConfigSchema>;

export interface DecisionEntry {
  repo: string;
  reason?: string;
}

export interface DecisionMap {
  dismissed: Map<string, string | undefined>;
  promoted: Map<string, string | undefined>;
}

export function loadDiscoveryInboxConfig(path: string): DiscoveryInboxConfig {
  if (!existsSync(path)) {
    return DiscoveryInboxConfigSchema.parse({});
  }
  const raw: unknown = parseYaml(readFileSync(path, 'utf8')) ?? {};
  return DiscoveryInboxConfigSchema.parse(raw);
}

export function loadDiscoveryDecisions(path: string): DecisionMap {
  if (!existsSync(path)) {
    return { dismissed: new Map(), promoted: new Map() };
  }
  const raw: unknown = parseYaml(readFileSync(path, 'utf8')) ?? {};
  const config = DiscoveryDecisionsConfigSchema.parse(raw);

  const dismissed = new Map<string, string | undefined>();
  for (const entry of config.dismissed) {
    dismissed.set(entry.repo.toLowerCase(), entry.reason);
  }

  const promoted = new Map<string, string | undefined>();
  for (const entry of config.promoted) {
    promoted.set(entry.repo.toLowerCase(), entry.reason);
  }

  return { dismissed, promoted };
}
