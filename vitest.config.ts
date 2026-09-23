import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source so tests run without a
// build step. Mirrors the `paths` mapping in tsconfig.base.json.
const root = import.meta.dirname;

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@starred/schema': resolve(root, 'packages/schema/src/index.ts'),
      '@starred/github-client': resolve(root, 'packages/github-client/src/index.ts'),
      '@starred/discovery/contracts': resolve(root, 'packages/discovery/src/contracts.ts'),
      '@starred/discovery': resolve(root, 'packages/discovery/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // The worker-thread pool can hang without output on some environments
    // (observed in review); the process-fork pool is robust for these suites.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      // Count every source file, not just imported ones, so a new untested
      // module shows up instead of silently raising the average.
      all: true,
      include: ['packages/*/src/**', 'apps/*/src/**'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/generate-schemas.ts', // build-time codegen
        '**/cli.ts', // process entry points (commander wiring; delegate to lib)
        // Same entry-point rationale: the classifier's commander wiring, split out
        // of cli.ts so tests can import construction without parseAsync (#56).
        // Every action delegates to covered lib code; fatal.ts stays covered.
        'packages/classifier/src/program.ts',
        'apps/*/src/main.tsx', // React bootstrap, no logic
        // Pure re-export barrels (no logic). NOTE: packages/exporter/src/index.ts
        // is the run() orchestration, NOT a barrel — keep it in the base.
        'packages/ai-schema/src/index.ts',
        'packages/deploy/src/index.ts',
        'packages/discovery/src/index.ts',
        'packages/github-client/src/index.ts',
        'packages/notifier/src/index.ts',
        'packages/schema/src/index.ts',
      ],
      // Regression FLOOR (global), a few points below current coverage — catches
      // a real drop without incentivizing coverage-gaming or breaking on
      // routine refactors. Raise as coverage genuinely improves.
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 75,
        functions: 78,
      },
    },
  },
});
