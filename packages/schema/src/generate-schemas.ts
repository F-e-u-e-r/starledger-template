/**
 * Generates JSON Schema files from the Zod runtime schemas so the two never
 * drift. Run via `pnpm schemas`.
 *
 * NOTE: cross-field invariants expressed with `.superRefine` (e.g. the
 * unavailable_fields rules) do NOT translate to JSON Schema. JSON Schema covers
 * structure and types; the cross-field invariants are enforced at runtime by
 * Zod (see CanonicalRepoSchema). This is documented in the P0 spec.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { StarsFileSchema } from './stars';
import { DatasetMetaSchema } from './dataset-meta';
import { RunMetaSchema } from './run-meta';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../schemas');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['stars.schema.json', StarsFileSchema, 'StarsFile'],
  ['dataset-meta.schema.json', DatasetMetaSchema, 'DatasetMeta'],
  ['run-meta.schema.json', RunMetaSchema, 'RunMeta'],
] as const;

for (const [file, schema, name] of targets) {
  const json = zodToJsonSchema(schema, { name, target: 'jsonSchema2019-09' });
  writeFileSync(resolve(outDir, file), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote schemas/${file}`);
}
