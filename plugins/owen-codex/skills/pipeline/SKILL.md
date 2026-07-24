---
name: pipeline
description: Configurable pipeline orchestrator for sequencing stages
---

# Pipeline Skill

`$pipeline` is the configurable pipeline orchestrator for OWX. It sequences stages
through a uniform `PipelineStage` interface, with state persistence and resume support.

## Default Autopilot Pipeline

The default Autopilot pipeline sequences:

```
deep-interview -> ralplan -> ultragoal -> code-review -> ultraqa
```

Ultragoal may assign independent lanes to native Codex subagents with explicit `agent_type` and bounded ownership. Explicit legacy Ralph pipelines remain available through custom stages, but Ralph is not the advertised default Autopilot loop.

## Configuration

Pipeline parameters are configurable per run:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxRalphIterations` | 10 | Quality-gate retry ceiling; legacy option name retained for compatibility |
| `agentType` | `executor` | Default native Codex subagent type for parallel lanes |

## Stage Interface

Every stage implements the `PipelineStage` interface:

```typescript
interface PipelineStage {
  readonly name: string;
  run(ctx: StageContext): Promise<StageResult>;
  canSkip?(ctx: StageContext): boolean;
}
```

Stages receive a `StageContext` with accumulated artifacts from prior stages and
return a `StageResult` with status, artifacts, and duration.

## Built-in Stages

- **deep-interview**: Requirements clarification and ambiguity gate.
- **ralplan**: Consensus planning (planner + architect + critic). Skips only when both `prd-*.md` and `test-spec-*.md` planning artifacts already exist **and** durable consensus evidence records Architect approval followed by Critic approval. Plan/test-spec files alone are not consensus evidence. If either review is missing, blocked, out of order, or non-approving, the stage remains in ralplan or fails with an explicit blocker/max-iteration outcome instead of progressing to execution. Carries any `deep-interview-*.md` spec paths forward for traceability.
- **ultragoal**: Durable goal-mode execution with `.owx/ultragoal` ledgers. Use native Codex subagents for independent parallel lanes when warranted.
- **code-review**: Merge-readiness review gate.
- **ultraqa**: Adversarial QA gate after a clean review; docs-only/trivially non-runtime changes may record an explicit skip reason.
- **ralph-verify**: Legacy/custom pipeline adapter retained for explicit non-default pipelines.

## State Management

Pipeline state persists via the ModeState system at `.owx/state/pipeline-state.json`.
The HUD renders pipeline phase automatically. Resume is supported from the last incomplete stage.

- **On start**: `owx state write --input '{"mode":"pipeline","active":true,"current_phase":"stage:ralplan"}' --json`
- **On stage transitions**: `owx state write --input '{"mode":"pipeline","current_phase":"stage:<name>"}' --json`
- **On completion**: `owx state write --input '{"mode":"pipeline","active":false,"current_phase":"complete"}' --json`

## API

```typescript
import {
  runPipeline,
  createAutopilotPipelineConfig,
  createDeepInterviewStage,
  createRalplanStage,
  createUltragoalStage,
  createCodeReviewStage,
  createUltraqaStage,
} from './pipeline/index.js';

const config = createAutopilotPipelineConfig('build feature X', {
  stages: [
    createDeepInterviewStage(),
    createRalplanStage(),
    createUltragoalStage(),
    createCodeReviewStage(),
    createUltraqaStage(),
  ],
});

const result = await runPipeline(config);
```

## Relationship to Other Modes

- **autopilot**: Autopilot can use pipeline as its execution engine (v0.8+)
- **ultragoal**: Autopilot delegates durable execution to Ultragoal by default
- **native Codex subagents**: Optional execution lanes inside an Ultragoal story when work is independent and bounded
- **ralph**: Available only for explicit legacy/custom pipelines
- **ralplan**: Pipeline planning runs RALPLAN consensus planning
