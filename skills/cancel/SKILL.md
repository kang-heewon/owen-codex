---
name: cancel
description: Cancel active OWX workflows in the current session, preserving terminal state and progress; reset all workflow state only when explicitly requested.
---

# Cancel

Stop the requested OWX workflow with the supported `owx state` CLI (or equivalent state tools). Default cancellation preserves progress, verification records, and terminal state. `--force` / `--all` explicitly requests a workspace-wide workflow-state reset; do not escalate to it merely because scoped cancellation failed.

Planning-only Ralplan completion keeps its owning skill's `active:true,current_phase:"paused"` guard until explicit cancellation or execution handoff. An approved plan alone is not a cancellation request.

## Resolve scope and ownership

1. Use the known current session ID and working directory. Pass both explicitly to every operation. If no session exists, use the CLI's resolved legacy scope; never substitute another session because the current one has no active modes.
2. Inspect `owx state list-active` and `owx state get-status` with that scope. These report modes/statuses, not an inventory of every session. Read status paths and `data` to confirm scope and ownership before writing. A malformed state is an error, not evidence that no workflow is active.
3. Identify the owning workflow and its linked children. Autopilot owns its recorded execution/QA/planning stages, including explicit legacy Ralph handoffs. Ralph owns only Ultrawork/Ecomode linked in the same scope; preserve standalone parallel work and unrelated sessions. Cancel children and then the owner so the final owner state reflects completed cancellation.
4. Stop any running workers through the available native agent controls, targeting only workers owned by the cancelled workflow. Marking a state record inactive does not interrupt an agent by itself.

Example scope inspection (set `SESSION_ID` and `WORKING_DIRECTORY` from the actual session):

```bash
SCOPE=$(jq -n --arg session "$SESSION_ID" --arg cwd "$WORKING_DIRECTORY" \
  '{session_id:$session,workingDirectory:$cwd}')
owx state list-active --input "$SCOPE" --json
owx state get-status --input "$SCOPE" --json
```

## Preserve terminal state

For each confirmed ordinary mode state, use `state_write`, which merges existing progress and synchronizes canonical skill activation. Do not use `state_clear` or raw file deletion for default cancellation.

The following terminal fields apply to Ralph and ordinary cancellable workflow states. Use a mode's owning workflow contract if it specifies a different terminal transition. Set `MODE` to the inspected mode; do not create a cancellation record for a nonexistent workflow.

```bash
CANCEL_INPUT=$(jq -n \
  --arg mode "$MODE" \
  --arg session "$SESSION_ID" \
  --arg cwd "$WORKING_DIRECTORY" \
  --arg completed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{mode:$mode,session_id:$session,workingDirectory:$cwd,
    active:false,current_phase:"cancelled",run_outcome:"cancelled",completed_at:$completed}')
owx state write --input "$CANCEL_INPUT" --json
```

After each write, read status again in the same scope. Success requires `active:false`, `current_phase:"cancelled"`, a populated `completed_at`, preserved progress/verification artifacts, and non-active linked children. Check the CLI exit code or state tool `isError`; report a failed transition rather than claiming cancellation. Preserve unrelated sessions. Report the cancelled mode and the retained progress location.

## Goal-backed workflows

Status may include `.owx/ultragoal/goals.json` with `source:"ultragoal-artifacts"`. This is a goal ledger, not an ordinary `.owx/state` mode file. A generic state write/clear does not cancel that ledger or the Codex goal.

Stop owned execution and follow the owning goal workflow's supported cancellation/pause controls when available. Preserve ledgers and checkpoints. The exposed `update_goal` tool cannot pause or cancel a goal; never mark an unfinished goal complete or blocked merely to cancel it. Do not call hidden goal endpoints or manually edit Codex goal state. If cancellation requires the user's goal UI control, report that remaining step and distinguish it from completed OWX state cancellation.

## Explicit workspace reset: `--force` / `--all`

An explicit reset authorizes removing ordinary workflow state across sessions, including legacy mode records. It is an exception to terminal-state preservation. First stop owned workers and inspect the state directories to inventory modes, sessions, and compatibility artifacts. Do not assume `state_list_active` enumerates all sessions or inactive records.

For each supported mode present, use the API's explicit all-session operation:

```bash
RESET_INPUT=$(jq -n --arg mode "$MODE" --arg cwd "$WORKING_DIRECTORY" \
  '{mode:$mode,workingDirectory:$cwd,all_sessions:true}')
owx state clear --input "$RESET_INPUT" --json
```

`mode` is required. Omitting `session_id` alone does not request a global reset; the runtime resolves the current session. `all_sessions:true` clears the named mode's global and session-scoped records and synchronizes its canonical activation state.

Inspect remaining compatibility artifacts before removing only those covered by the explicit reset (for example Ralph verification/plan-state sidecars or obsolete workflow state files). Do not delete source files, user plans, goal ledgers, checkpoints outside the requested reset scope, shared live tracking, or active process lock/PID files indiscriminately. Report unsupported modes or artifacts that could not be safely cleared. Verify the selected state paths are gone and report exactly what was reset; do not claim that a native Codex goal was cleared.

If no active modes exist in the requested scope, report that result without deleting inactive records or escalating to a workspace reset.
