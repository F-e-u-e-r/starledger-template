/**
 * Generates JSON Schema files from the Zod runtime schemas so the two never
 * drift. Run via `pnpm schemas`.
 *
 * The emitted files are STRUCTURAL PROJECTIONS, not complete validators
 * (P7 §4.0): NEITHER `.superRefine` invariants (I-1..I-6, alias uniqueness)
 * NOR scalar `.refine` rules (slash/whitespace shape, control/format-character
 * bans, NFC normalization, the `Z`-suffix timestamp requirement) translate to
 * JSON Schema. The Zod schemas are the single source of truth and the only
 * complete validators; each emitted file carries a `$comment` saying so. This
 * mirrors the P0/P3 schema generators.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { SkillsAliasesSchema } from './aliases';
import { SkillsClassificationSchema } from './artifact';
import { SkillsClassificationMetaSchema } from './meta';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../schemas');
mkdirSync(outDir, { recursive: true });

const PROJECTION_NOTE =
  'Structural projection generated from @starred/skills-schema (Zod, the single source of truth). ' +
  'Zod .refine/.superRefine constraints (scalar shape and character rules, normalization, ' +
  'I-1..I-6 and cross-field invariants) do not translate to JSON Schema, so passing this file ' +
  'does NOT establish contract validity (P7 section 4.0). Do not use as a complete validator.';

const targets = [
  ['skills-classification.schema.json', SkillsClassificationSchema, 'SkillsClassification'],
  [
    'skills-classification-meta.schema.json',
    SkillsClassificationMetaSchema,
    'SkillsClassificationMeta',
  ],
  ['skills-aliases.schema.json', SkillsAliasesSchema, 'SkillsAliases'],
] as const;

for (const [file, schema, name] of targets) {
  const json = zodToJsonSchema(schema, { name, target: 'jsonSchema2019-09' });
  const stamped = { $comment: PROJECTION_NOTE, ...json };
  writeFileSync(resolve(outDir, file), JSON.stringify(stamped, null, 2) + '\n');
  console.log(`wrote schemas/${file}`);
}
