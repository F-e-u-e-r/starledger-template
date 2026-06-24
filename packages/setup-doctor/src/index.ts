export const SETUP_DOCTOR_VERSION = '0.1.0';

export type { CheckResult, CheckStatus } from './report';
export {
  EXIT_INCOMPLETE,
  EXIT_INVALID,
  EXIT_READY,
  dedupeById,
  exitCodeFor,
  formatResult,
  summarize,
  verdict,
} from './report';
export type { DoctorOptions, Mode } from './doctor';
export { ALL_MODES, resolveModes, runDoctor } from './doctor';
export * from './checks';
