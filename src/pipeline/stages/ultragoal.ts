/**
 * Ultragoal stage adapter for the default Autopilot loop.
 *
 * Produces a model-facing instruction for durable goal-mode execution.
 */

import type { PipelineStage, StageContext, StageResult } from '../types.js';

export interface UltragoalDescriptor {
  task: string;
  cwd: string;
  sessionId?: string;
  ralplanArtifacts: Record<string, unknown>;
  instruction: string;
}

export function createUltragoalStage(): PipelineStage {
  return {
    name: 'ultragoal',

    async run(ctx: StageContext): Promise<StageResult> {
      const startTime = Date.now();
      const ralplanArtifacts = ctx.artifacts.ralplan as Record<string, unknown> | undefined;
      const descriptor: UltragoalDescriptor = {
        task: ctx.task,
        cwd: ctx.cwd,
        sessionId: ctx.sessionId,
        ralplanArtifacts: ralplanArtifacts ?? {},
        instruction: buildUltragoalInstruction(ctx.task),
      };

      return {
        status: 'completed',
        artifacts: {
          stage: 'ultragoal',
          ultragoalDescriptor: descriptor,
          instruction: descriptor.instruction,
        },
        duration_ms: Date.now() - startTime,
      };
    },
  };
}

export function buildUltragoalInstruction(task: string): string {
  return `$ultragoal ${JSON.stringify(task)}`;
}
