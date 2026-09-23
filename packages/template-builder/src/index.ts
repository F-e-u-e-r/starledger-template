export const TEMPLATE_BUILDER_VERSION = '0.1.0';

export type { BuildManifest, BuildOptions } from './build';
export { buildTemplate } from './build';
export type { NeutralizeResult, StripResult } from './workflows';
export { OMIT_STEP_MARKER, neutralizeSchedule, stripOmittedSteps } from './workflows';
export {
  ALLOW_DIRS,
  ALLOW_FILES,
  EXCLUDE_BASENAMES,
  EXCLUDE_SEGMENTS,
  EXCLUDE_WORKFLOWS,
  NEUTRALIZE_SCHEDULE_WORKFLOWS,
  README_OUTPUT,
  README_TEMPLATE,
  isExcluded,
} from './allowlist';
