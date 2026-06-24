import { z } from 'zod';

/**
 * A StarLedger-controlled classification methodology version. Bump this when
 * the agent instructions, selected model, reasoning level, or executor policy
 * changes in a way that should deliberately reclassify repositories.
 */
export const AGENT_EXECUTION_PROFILE_VERSION = 'agent-v1';

export const AGENT_EXECUTOR_KINDS = ['claude-routine', 'codex-automation'] as const;
export const AgentExecutorKindSchema = z.enum(AGENT_EXECUTOR_KINDS);
export type AgentExecutorKind = z.infer<typeof AgentExecutorKindSchema>;
export const DEFAULT_AGENT_EXECUTOR_KIND: AgentExecutorKind = 'claude-routine';

/**
 * The profile is methodology, not executor identity. The concrete executor is
 * bound separately to each manifest/job so a Codex candidate cannot satisfy a
 * Claude manifest, and switching executor produces new job ids.
 */
export const AgentExecutionProfileSchema = z
  .object({
    execution_profile_version: z.string().min(1),
  })
  .strict();
export type AgentExecutionProfile = z.infer<typeof AgentExecutionProfileSchema>;

export const DEFAULT_AGENT_EXECUTION_PROFILE: AgentExecutionProfile = {
  execution_profile_version: AGENT_EXECUTION_PROFILE_VERSION,
};
