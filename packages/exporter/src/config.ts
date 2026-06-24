import { existsSync, readFileSync } from 'node:fs';
import { TerminalError } from '@starred/github-client';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const ConfigSchema = z
  .object({
    username: z.string().min(1).nullable().default(null),
    hydrate_batch_size: z.number().int().min(1).max(100).default(75),
    max_degraded_ratio: z.number().min(0).max(1).default(0.05),
    allow_empty: z.boolean().default(false),
    // Budget reserve floor: defer the run if GraphQL rate `remaining` is below
    // this before heavy work. 0 disables the guard.
    rate_limit_reserve: z.number().int().min(0).default(0),
    output: z
      .object({
        stars: z.string().default('stars.json'),
        dataset_meta: z.string().default('dataset-meta.json'),
        run_meta: z.string().default('run-meta.json'),
      })
      .strict()
      .default({}),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path?: string): Config {
  if (path !== undefined && existsSync(path)) {
    const raw: unknown = parseYaml(readFileSync(path, 'utf8')) ?? {};
    return ConfigSchema.parse(raw);
  }
  return ConfigSchema.parse({});
}

export class MissingTokenError extends TerminalError {
  constructor() {
    super(
      'STAR_SYNC_TOKEN is not set. Provide a fine-grained PAT with `Starring: read`.',
      'MISSING_TOKEN',
    );
  }
}

export function readToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.STAR_SYNC_TOKEN?.trim();
  if (!token) throw new MissingTokenError();
  return token;
}
