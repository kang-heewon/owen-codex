---
name: prometheus-strict
description: "[OMX] Clean-room interview-driven planner: Metis clarifies, Momus challenges, Oracle synthesizes, then hands off to $ultragoal/$team."
argument-hint: "<goal or problem statement>"
---

# Prometheus Strict

Clean-room OMX planning workflow inspired by the high-level OMO Prometheus concept only. This skill does not copy implementation, prompts, wording, control flow, or runtime code from OMO. It reimplements the idea under this repository's MIT-licensed skill conventions.

Credit: Inspired by OMO Prometheus (`code-yeongyu/oh-my-openagent`), reimplemented from concept under MIT.

<Purpose>
Prometheus Strict creates a rigorous plan before execution when ambiguity is still risky. It separates three planning voices: Metis clarifies requirements, Momus challenges assumptions and validation gaps, and Oracle synthesizes the handoff-ready OMX-native plan.

The output is a planning-only artifact for `$ultragoal` and, when independent lanes are justified, `$team`. When a durable artifact is useful, store or request the final plan under `.omx/plans/prometheus-strict/`.
</Purpose>

<Use_When>
- The task is important enough that a shallow plan could produce wrong work.
- Requirements are partially known but acceptance criteria, boundaries, risks, or validation are incomplete.
- The user wants a strict interview before execution.
- A future `$ultragoal` story needs durable scope, tests, and handoff sequencing.
- A team split may be needed, but the lanes are not yet safe to assign.
</Use_When>

<Do_Not_Use_When>
- The user asks for immediate implementation of a clear, low-risk change; use the normal executor path.
- The task is only a repository lookup or explanation; use `explore`/`analyze` as appropriate.
- The user needs adversarial execution QA after code changes; use `$ultraqa`.
- The user wants hook behavior, Sisyphus behavior, or a `start-work` port. Those are explicit non-goals.
</Do_Not_Use_When>

<Why_This_Exists>
OMX already has `$plan`, `$ralplan`, and `$deep-interview`. Prometheus Strict exists for a narrower case: an explicit clean-room strict-planning lane with named clarification, critique, and synthesis roles, plus a durable `.omx/plans/prometheus-strict/` handoff contract. It is not a replacement for execution workflows.
</Why_This_Exists>

<Execution_Policy>
- Stay planning-only. Do not edit source code during this skill unless the user starts a separate execution workflow afterward.
- Preserve clean-room boundaries. Do not copy or imitate OMO wording, source, prompts, runtime behavior, or control flow.
- Keep non-goals visible: No hook implementation. No Sisyphus/start-work port. No automatic external-production actions.
- Ask one question at a time only when the answer materially changes scope, safety, or validation.
- If a safe assumption is available, state it and continue.
- Use repository reads when needed to make paths, tests, and handoff commands concrete.
- Recommend `$team` only when Oracle identifies independent, bounded, verifiable lanes.

### Structured Question Surface

Every Metis/Momus/Oracle question to the user MUST go through the surface-appropriate structured question path. Plain prose questioning is the last fallback, not the default.

- In attached-tmux OMX runtime, use `omx question` as the OMX-owned structured question surface (this is the `AskUserQuestion` equivalent for Prometheus Strict). From attached-tmux Bash/tool paths, prefix the command with `OMX_QUESTION_RETURN_PANE=$TMUX_PANE` (or a concrete `%pane` value) so the leader-pane return target is preserved.
- Wait for the `omx question` JSON answer before scoring ambiguity, asking another round, or handing off; prefer `answers[0].answer` / `answers[]`, and use the legacy top-level `answer` only as a compatibility fallback.
- Outside tmux, use the native structured input tool when one is available.
- Only when neither structured surface can render, ask exactly one concise plain-text question and wait for the answer.
- Never batch multiple interview rounds into a single `questions[]` form; Prometheus Strict is one round at a time, like deep-interview.
</Execution_Policy>

<Steps>
### 1. Intake and Safety Bounds

Restate the target result, known constraints, deliverables, validation expectations, and stop condition. Identify whether this turn is planning-only or whether the user also requested downstream execution.

If the prompt contains destructive, credential-gated, external-production, or materially scope-changing decisions, hold those decisions for explicit user confirmation. Otherwise, continue through the planning loop.

### 2. Metis Interview

Use `prometheus-strict-metis` as the interview voice. When native subagents are available, invoke the dedicated agent; otherwise run the same role in-context without editing files.

Metis discovers success criteria, non-goals, evidence versus assumptions, required artifacts, likely execution lanes, and missing decisions. Ask exactly one high-leverage question only when needed.

### 3. Momus Challenge

Use `prometheus-strict-momus` as the adversarial critique voice. When native subagents are available, invoke the dedicated agent; otherwise run the same role in-context without editing files.

Momus challenges underspecified acceptance criteria, unsafe assumptions, hidden destructive steps, overbroad scope, missing verification, ownership conflicts, and `$ultragoal`/`$team` handoff ambiguity.

### 4. Oracle Synthesis

Use `prometheus-strict-oracle` as the synthesis voice. When native subagents are available, invoke the dedicated agent; otherwise run the same role in-context without editing files.

Oracle produces the final objective, scope and non-goals, accepted assumptions, resolved critique, sequenced steps or lanes, verification matrix, rollback/escalation conditions, and recommended OMX handoff.

### 5. Handoff

Prometheus Strict stops with a plan unless the user explicitly invokes or authorizes the next workflow. Prefer this sequence:

```text
$ultragoal "<Oracle plan summary or .omx/plans/prometheus-strict/<slug>.md>"
$team <N>:executor "execute the approved Ultragoal story in parallel lanes"  # only when warranted
```
</Steps>

<Tool_Usage>
- Use read-only repository inspection to verify referenced files, commands, and existing conventions.
- Use `prometheus-strict-metis`, `prometheus-strict-momus`, and `prometheus-strict-oracle` sequentially; do not fan out implementation work from this skill.
- Use `$ultragoal` only as the recommended execution handoff after the plan is ready.
- Use `$team` only when parallel lanes are independent and verifiable.
</Tool_Usage>

## State Management

Prometheus Strict does not own a long-running runtime loop. If a durable planning artifact is needed, write the final plan to `.omx/plans/prometheus-strict/<slug>.md`. Draft-only or inline plans may set the artifact path to `N/A - inline plan only`.

Do not create hook state, Sisyphus state, or `start-work` compatibility state for this skill.

<Final_Checklist>
- [ ] Target result is explicit.
- [ ] Scope and non-goals are explicit.
- [ ] Acceptance criteria are measurable.
- [ ] Metis clarification has no unresolved blocking question.
- [ ] Momus objections are resolved or carried forward as explicit blockers.
- [ ] Oracle plan includes a verification matrix.
- [ ] Handoff recommends `$ultragoal` and `$team` only when warranted.
- [ ] Clean-room credit is preserved.
- [ ] No hook implementation or Sisyphus/start-work port was introduced.
</Final_Checklist>

<Advanced>
## Output Contract

If writing a durable plan file, store this markdown at `.omx/plans/prometheus-strict/<slug>.md` and reference that path in the handoff.

```markdown
## Prometheus Strict Plan

### Target Result
- <one-sentence objective>

### Clarified Requirements (Metis)
- <requirement / acceptance criterion>

### Critique Resolved (Momus)
- <risk or objection> -> <resolution>

### Oracle Execution Plan
1. <sequenced step or lane>

### Verification Matrix
| Claim | Required evidence | Owner/lane |
| --- | --- | --- |
| <claim> | <test/build/lint/e2e/doc evidence> | <owner> |

### Artifact
- Durable plan path: `.omx/plans/prometheus-strict/<slug>.md` or `N/A - inline plan only`

### Handoff
- Recommended next workflow: <$ultragoal / $team / direct execution / none>
- Stop condition: <what proves the plan is ready or why it is blocked>

### Clean-Room Credit
Inspired by OMO Prometheus (`code-yeongyu/oh-my-openagent`), reimplemented from concept under MIT.
```

## Failure and Escalation

Escalate instead of planning when a necessary answer cannot be inferred safely, the next step is destructive or credential-gated, required repository context is unavailable, or the user asks for behavior outside the non-goals.
</Advanced>

Original task:
{{PROMPT}}
