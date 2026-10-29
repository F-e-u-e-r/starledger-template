/**
 * Generates JSON Schema files from the Zod runtime schemas so the two never
 * drift. Run via `pnpm schemas`.
 *
 * NOTE: canonical-form invariants expressed with `.superRefine` (annotations
 * sorted/unique by node_id; tags sorted/unique; readme/metadata source
 * agreement) do NOT translate to JSON Schema. JSON Schema covers structure and
 * types; those invariants are enforced at runtime by Zod. This mirrors the P0
 * schema generator.
 *
 * Emitted with Zod 4's native `z.toJSONSchema` (draft 2020-12, flat root); see
 * packages/schema/src/generate-schemas.ts for the equivalence note.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AiAnnotationsSchema } from './artifact';
import { ClassificationCandidateSchema } from './candidate';
import { ClassificationJobSchema } from './job';
import { ClassificationManifestSchema } from './manifest';
import { AiAnnotationsMetaSchema } from './meta';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../schemas');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['ai-annotations.schema.json', AiAnnotationsSchema],
  ['ai-annotations-meta.schema.json', AiAnnotationsMetaSchema],
  ['classification-job.schema.json', ClassificationJobSchema],
  ['classification-manifest.schema.json', ClassificationManifestSchema],
  ['classification-candidate.schema.json', ClassificationCandidateSchema],
] as const;

for (const [file, schema] of targets) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  writeFileSync(resolve(outDir, file), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote schemas/${file}`);
}
