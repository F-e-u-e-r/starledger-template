/**
 * Generates JSON Schema files from the Zod runtime schemas so the two never
 * drift. Run via `pnpm schemas`.
 *
 * NOTE: canonical-form invariants expressed with `.superRefine` (annotations
 * sorted/unique by node_id; tags sorted/unique; readme/metadata source
 * agreement) do NOT translate to JSON Schema. JSON Schema covers structure and
 * types; those invariants are enforced at runtime by Zod. This mirrors the P0
 * schema generator.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AiAnnotationsSchema } from './artifact';
import { ClassificationCandidateSchema } from './candidate';
import { ClassificationJobSchema } from './job';
import { ClassificationManifestSchema } from './manifest';
import { AiAnnotationsMetaSchema } from './meta';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../schemas');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['ai-annotations.schema.json', AiAnnotationsSchema, 'AiAnnotations'],
  ['ai-annotations-meta.schema.json', AiAnnotationsMetaSchema, 'AiAnnotationsMeta'],
  ['classification-job.schema.json', ClassificationJobSchema, 'ClassificationJob'],
  ['classification-manifest.schema.json', ClassificationManifestSchema, 'ClassificationManifest'],
  [
    'classification-candidate.schema.json',
    ClassificationCandidateSchema,
    'ClassificationCandidate',
  ],
] as const;

for (const [file, schema, name] of targets) {
  const json = zodToJsonSchema(schema, { name, target: 'jsonSchema2019-09' });
  writeFileSync(resolve(outDir, file), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote schemas/${file}`);
}
