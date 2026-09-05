---
name: ralplan
description: Alias for $plan --consensus
---

# Consensus Planning Alias

Read [Plan](../plan/SKILL.md) and run its consensus mode as `$plan --consensus <arguments>`. Forward the user's task text and all arguments unchanged, including `--interactive` and `--deliberate`; do not restart an existing planning session or switch to another planning mode.

Before planning, also read the [consensus boundary contract](references/consensus-boundary.md) for context intake, durable review evidence, and state transitions. Plan owns the Planner → Architect → Critic procedure, RALPLAN-DR deliberation, ADR, and execution-lane selection. This alias does not maintain a second copy of that procedure.

Without `--interactive`, return the approved plan with the planning guard paused and active. Execution requires an explicit handoff; never implement directly from this planning alias.
