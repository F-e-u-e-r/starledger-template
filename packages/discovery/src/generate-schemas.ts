import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DiscoveryCandidatesFileSchema } from './schemas';
import { DiscoveryCandidatesMetaSchema } from './schemas';

// Emitted with Zod 4's native `z.toJSONSchema` (draft 2020-12, flat root); see
// packages/schema/src/generate-schemas.ts for the equivalence note.
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../schemas');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['discovery-candidates.schema.json', DiscoveryCandidatesFileSchema],
  ['discovery-candidates-meta.schema.json', DiscoveryCandidatesMetaSchema],
] as const;

for (const [file, schema] of targets) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  writeFileSync(resolve(outDir, file), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote schemas/${file}`);
}
