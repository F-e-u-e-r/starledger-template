/**
 * Generates JSON Schema files from the Zod runtime schemas so the two never
 * drift. Run via `pnpm schemas`.
 *
 * NOTE: cross-field invariants expressed with `.superRefine` (e.g. the
 * unavailable_fields rules) do NOT translate to JSON Schema. JSON Schema covers
 * structure and types; the cross-field invariants are enforced at runtime by
 * Zod (see CanonicalRepoSchema). This is documented in the P0 spec.
 *
 * Emitted with Zod 4's native `z.toJSONSchema` (draft 2020-12, flat root). The
 * previous zod-to-json-schema output (draft 2019-09, `$ref` + `definitions`
 * wrapper) is structurally equivalent — same properties, required sets, types,
 * enums, bounds, formats, patterns and `additionalProperties`. The only
 * additions are the safe-integer `maximum` (and `minimum` where nothing bounds
 * the field below) that Zod 4's `.int()` now enforces at runtime too.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { StarsFileSchema } from './stars';
import { DatasetMetaSchema } from './dataset-meta';
import { RunMetaSchema } from './run-meta';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../schemas');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['stars.schema.json', StarsFileSchema],
  ['dataset-meta.schema.json', DatasetMetaSchema],
  ['run-meta.schema.json', RunMetaSchema],
] as const;

for (const [file, schema] of targets) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  writeFileSync(resolve(outDir, file), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote schemas/${file}`);
}
