#!/usr/bin/env node
// Entry point ONLY. Every workflow, script, and the published bin invoke THIS
// path (`packages/classifier/src/cli.ts` / `dist/cli.js`), so it must keep
// executing the program; construction lives in program.ts so tests can import
// it (and fatal.ts) without triggering parseAsync at import time (issue #56).
import { buildProgram } from './program';

void buildProgram().parseAsync(process.argv);
