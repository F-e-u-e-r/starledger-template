import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Bundle the internal workspace packages so the published CLI is
  // self-contained (their dev `exports` resolve to TypeScript source).
  noExternal: [/^@starred\//],
});
