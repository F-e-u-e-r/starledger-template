import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DiscoveryCandidatesFileSchema } from './schemas';
import { DiscoveryCandidatesMetaSchema } from './schemas';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../schemas');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['discovery-candidates.schema.json', DiscoveryCandidatesFileSchema, 'DiscoveryCandidatesFile'],
  [
    'discovery-candidates-meta.schema.json',
    DiscoveryCandidatesMetaSchema,
    'DiscoveryCandidatesMeta',
  ],
] as const;

for (const [file, schema, name] of targets) {
  const json = zodToJsonSchema(schema, { name, target: 'jsonSchema2019-09' });
  writeFileSync(resolve(outDir, file), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote schemas/${file}`);
}
