# Consensus Boundary Contract

Read this with the Plan consensus procedure before running Ralplan. These obligations preserve the runtime planning guard and review evidence across execution handoffs.

## Pre-context Intake

Reuse the latest relevant `.owx/context/{slug}-*.md` snapshot, or create `.owx/context/{slug}-{timestamp}.md` using UTC `YYYYMMDDTHHMMSSZ`. Record the task, desired outcome, known evidence, constraints, open questions, and likely codebase touchpoints. Gather repository facts before asking the user about them. If material ambiguity remains, run `$deep-interview --quick <task>` before consensus planning.

If the plan depends on external documentation or dependency behavior, use `$best-practice-research` and its `researcher` lane to establish that evidence before handoff. When prior `$autoresearch` or `$autoresearch-goal` work exists, treat its approved artifact as evidence for the plan. Do not include Autoresearch as a final architecture or runtime component unless the user requested ongoing research automation; synthesize the evidence into the `$ralplan` ADR, risks, and verification steps.

## Review evidence

Select the installed native `agent_type` for each required role. If the role cannot be selected, report `role_identity_unavailable` and stop that lane; task labels do not establish role identity. Scholastic may supply advisory evidence but cannot replace Architect or Critic.

Before an Autopilot, Pipeline, Ultragoal, Ralph, or implementation handoff, persist:

- `planning_artifacts`: PRD/test-spec paths.
- `ralplan_architect_review`: the completed approving Architect review.
- `ralplan_critic_review`: the completed approving Critic review, recorded after Architect.
- `ralplan_consensus_gate.complete:true` only when both reviews approve in Architect→Critic order.

Existing PRD/test-spec files alone do not complete consensus or authorize execution. Missing or non-approving review evidence keeps the workflow in the appropriate review/re-review step; retain the Plan procedure's iteration limit and report unresolved outcomes.

## Planning and execution state

While Ralplan is active without an explicit execution handoff, implementation writes are out of scope. It may inspect the repository and write planning artifacts in `.owx/context/`, `.owx/plans/`, `.owx/specs/`, and required `.owx/state/` records.

For a planning-only result, persist the approved evidence and retain `active:true,current_phase:"paused"`. Use `active:true,current_phase:"waiting_for_input"` only when a required user answer is missing. Do not deactivate or cancel the guard merely to finish the response.

An explicit execution handoff terminalizes planning state before activating the selected execution lane. Pass the approved plan, evidence, and the Plan procedure's staffing/verification context to that lane. Do not continue into direct code edits in the Ralplan session.

## Pre-Execution Gate

The runtime may redirect underspecified execution requests to Ralplan. Concrete anchors (such as a file, symbol, issue, test target, or acceptance criteria) can satisfy that intake gate. The `force:` and `! ` prefixes bypass intake classification; they do not manufacture consensus evidence or release an already-active planning guard. Follow the runtime's actual routing result rather than reimplementing its prompt classifier here.
