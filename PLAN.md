# PLAN.md — Hardening OWX into a Slop-Resistant Agentic Development Control Plane

Status: Draft v0.2
Date: 2026-07-23
Audience: product, engineering, agent/runtime maintainers, contributors
Scope: OWX CLI, skills, native agent delegation, state, trace, docs, plugin packaging, and product surface

---

## 0. Executive Thesis

OWX should not become “one more coding agent that generates more stuff.”

The ambitious version of OWX is a **control plane that turns ambiguous LLM output into durable, shippable, evidence-backed software work**. Its differentiation should be that it removes AI slop rather than amplifying it.

The product should be designed around this principle:

> AI may propose, decompose, implement, verify, and summarize — but it must not be allowed to silently expand the product surface, invent concepts, claim completion without evidence, or ship changes outside an explicit contract.

This roadmap shifts OWX from a broad collection of powerful agent workflows into a coherent operating system for **hardening LLM work**.

The end state:

```text
Natural language intent
  → WorkSpec
  → scoped execution
  → evidence collection
  → surface governance
  → shrink pass
  → proof-backed report
  → durable product change
```

---

## 1. What “Hard Surface” Means

A hard product surface is not merely a clean UI. It is the part of the product that users can trust, remember, automate against, and teach to others.

For OWX, a hard surface has these properties:

1. **Small public vocabulary**
   Users should not need to understand every internal engine, prompt, skill, agent, or state file.

2. **Stable command model**
   Public commands, flags, output formats, state names, and error codes are registered, tested, and versioned.

3. **Explicit work contracts**
   Large tasks are not executed directly from vague natural language. They are compiled into WorkSpecs with scope, non-goals, acceptance criteria, and verification requirements.

4. **Evidence-backed completion**
   OWX never reports “done” merely because an agent says it is done. Completion must be supported by proof bundles.

5. **Mandatory reduction after generation**
   LLMs are good at generating; products require cutting. Every substantial work item should pass through a shrink/diff-diet phase.

6. **Surface change governance**
   Agents can propose public surface changes, but they cannot land them without explicit surface review.

7. **Recoverable failure**
   Every failed state should include cause, evidence, and the next safe action.

8. **Less magic, more contracts**
   OWX should feel powerful, but internally it should be boring: schemas, registries, finite state machines, snapshots, checkers, and reports.

---

## 2. The Core Product Problem: AI Slop

LLMs tend to create slop when asked to pursue broad goals. Slop is not only low-quality prose. In a software product, slop includes:

### 2.1 Concept Slop

Multiple names for the same thing, or slightly different concepts that users cannot distinguish.

Examples:

```text
goal
ultragoal
performance-goal
autoresearch-goal
ralph
autopilot
plan
ralplan
mission
work
```

This may be internally meaningful, but public exposure creates cognitive debt.

### 2.2 Surface Slop

Commands, flags, config keys, states, output modes, and docs accumulate without a strict admission rule.

Typical symptoms:

```text
--auto
--smart
--deep
--force
--safe
--fast
--thorough
--interactive
--non-interactive
```

These often represent unresolved product decisions rather than real user needs.

### 2.3 Documentation Slop

Docs become verbose, inspirational, overlapping, or non-operational.

Bad documentation answers:

```text
What is possible?
```

Good documentation answers:

```text
When should I use this?
What command do I run?
What output should I expect?
What can go wrong?
How do I recover?
```

### 2.4 Code Slop

LLM-generated code often leaves behind:

- speculative abstractions
- one-callsite helpers
- duplicate wrappers
- loose option objects
- silent fallbacks
- unused exports
- broad try/catch blocks
- tests that only confirm mocks
- TODOs that look like product thinking but are really unresolved design

### 2.5 Report Slop

Agents often produce confident summaries that exceed the evidence.

Bad:

```text
OAuth login is complete and production-ready.
```

Better:

```text
Status: implemented and locally verified.

Evidence:
- typecheck passed
- unit tests passed
- invalid-state callback path tested

Not verified:
- real provider credentials
- production redirect URL
- browser E2E login
```

OWX should treat unsupported claims as product defects.

---

## 3. North Star

OWX should become:

> The system that makes agentic coding outputs shippable.

Not:

```text
A bigger prompt library.
A more chaotic multi-agent swarm.
A CLI with dozens of equally important commands.
A tool that hides uncertainty behind confident summaries.
```

But:

```text
A work contract compiler.
A bounded execution orchestrator.
A proof collector.
A public surface governor.
A shrink/reduction system.
A recovery-oriented control plane.
```

A possible product tagline:

```text
OWX removes AI slop from agentic development.
```

Or:

```text
OWX turns LLM output into durable software work.
```

---

## 4. Product Principles

### Principle 1 — Natural language is an input, not internal state

Users may describe work in natural language, but OWX should convert that intent into structured artifacts before durable execution.

Primary structured artifacts:

```text
WorkSpec
SurfaceChange
ProofBundle
Report
LifecycleState
SurfaceRegistry
```

### Principle 2 — No evidence, no claim

OWX reports must be generated from proof bundles. If a claim cannot point to evidence, it must be removed, downgraded, or listed as unverified.

### Principle 3 — Public surface is more expensive than internal complexity

Internal engines can be complex. Public concepts must be few.

Use internal routing to reuse existing engines, but expose a smaller user-facing model.

### Principle 4 — Agents propose; contracts dispose

Agents can suggest changes, but schemas, registries, tests, and gates decide what lands.

### Principle 5 — Shrink is mandatory

Every substantial LLM-generated change should include a reduction pass after implementation and before final report.

### Principle 6 — Recovery is part of the UX

A failure without a next action is an incomplete product state.

### Principle 7 — Advanced power must not leak into first-run UX

OWX can keep advanced capabilities like Codex-native agent delegation, native hooks, API servers, and auth hot-swapping. They should not crowd the core path.

### Principle 8 — Defaults before flags

Before adding a public flag, ask:

```text
Can OWX infer this?
Can this be a profile?
Can this be policy?
Can this stay internal?
Does this reduce or increase user decisions?
```

---

## 5. Target Public Product Shape

OWX should collapse toward a smaller public model.

### 5.1 Core Concepts

Keep the public vocabulary small:

```text
Work       A tracked unit of user intent, backed by a WorkSpec, evidence, and report.
Spec       The contract that defines scope, non-goals, acceptance, and verification.
Agent      A bounded role that performs tasks but cannot silently expand the product surface.
Evidence   Test results, logs, diffs, reviews, and checks that support claims.
Report     A proof-backed summary of what changed, what passed, what failed, and what remains unverified.
Policy     Rules that govern execution, safety, surface changes, and verification.
Surface    User-visible commands, flags, states, config, errors, outputs, and docs.
```

### 5.2 Internalize or Deprecate as Public Terms

The following may remain internally valuable, but should not all be first-class public concepts:

```text
ultragoal
ralph
autopilot
autoresearch-goal
performance-goal
ralplan
spark
ledger
mailbox
worker runtime details
```

They can become engines, modes, skills, or advanced implementation details under the public `Work` model.

### 5.3 Suggested Core Commands

Long term, the core help surface should fit on one screen:

```text
owx setup       Install or configure OWX for this project/user.
owx doctor      Diagnose environment, plugin, native, and state readiness.
owx work        Compile, run, verify, and report durable work.
owx status      Show current work, blockers, evidence, and next actions.
owx report      Generate proof-backed reports from completed or active work.
owx review      Run correctness, quality, surface, and slop checks.
owx surface     Inspect and govern public product surface.
```

Advanced/internal commands may remain available, but should be hidden from the default path or grouped under advanced help.

---

## 6. Core Primitive: WorkSpec

### 6.1 Purpose

A WorkSpec is the contract between the user, OWX, and the agents.

OWX should not run large durable work directly from a vague prompt. It should first compile the prompt into a WorkSpec.

### 6.2 Minimal Schema

```yaml
apiVersion: owx.dev/v1
kind: WorkSpec

id: work_20260630_example
summary: "Add OAuth login"

intent:
  outcome: "Users can sign in with an external OAuth provider."
  user_value: "Users do not need password-only accounts."

scope:
  include:
    - "OAuth login entry point"
    - "OAuth callback handling"
    - "session creation"
    - "success and failure tests"
  exclude:
    - "account linking"
    - "multi-provider management UI"
    - "production provider credential provisioning"

surface:
  allowed_public_changes:
    - "login UI text"
    - "auth callback route"
  forbidden_public_changes:
    - "new CLI commands"
    - "new config file format"
    - "new product terminology"

files:
  allowed:
    - "src/auth/**"
    - "src/routes/**"
    - "tests/auth/**"
  forbidden:
    - "src/cli/**"
    - "surface/**"
    - "docs/**"

risk:
  requires_confirmation:
    - "new dependency"
    - "schema migration"
    - "secret storage"

acceptance:
  - id: auth-route
    description: "OAuth login route redirects correctly."
  - id: callback-success
    description: "Callback creates a session on success."
  - id: callback-failure
    description: "Callback handles denied access and invalid state."
  - id: tests
    command: "npm test"
  - id: typecheck
    command: "npm run build"

verification:
  required:
    - typecheck
    - tests
    - surface-check
    - code-review

reporting:
  must_include:
    - changed_files
    - evidence
    - unverified_assumptions
    - follow_up_risks
```

### 6.3 WorkSpec Rules

```text
No WorkSpec → no durable execution.
No acceptance criteria → no completed status.
No non-goals → no large work.
No proof bundle → no verified report.
No surface permission → no public surface changes.
```

### 6.4 WorkSpec CLI

MVP commands:

```bash
owx work compile "add OAuth login"
owx work show
owx work run PLAN.work.yml
owx work status
owx work verify
owx work report
owx work revise
```

Future commands:

```bash
owx work diff
owx work explain
owx work replay
owx work archive
```

---

## 7. Core Primitive: Surface Registry

### 7.1 Purpose

The Surface Registry is the constitution of OWX's public product surface.

Agents and contributors should not be able to accidentally create new public concepts, commands, states, config keys, or output formats.

### 7.2 Proposed Files

```text
surface/
  commands.yml
  concepts.yml
  states.yml
  errors.yml
  outputs.yml
  config.yml
  docs.yml
  policies.yml
```

### 7.3 Example: commands.yml

```yaml
commands:
  - name: "owx setup"
    tier: core
    status: stable
    purpose: "Install or configure OWX."
    hidden: false

  - name: "owx doctor"
    tier: core
    status: stable
    purpose: "Diagnose environment and runtime readiness."
    hidden: false

  - name: "owx work"
    tier: core
    status: beta
    purpose: "Compile, run, verify, and report durable work."
    hidden: false

  - name: "owx ultragoal"
    tier: internal
    status: legacy
    purpose: "Durable execution engine behind owx work."
    hidden: true
```

### 7.4 Example: concepts.yml

```yaml
concepts:
  - term: Work
    public: true
    definition: "A tracked unit of user intent backed by a WorkSpec, evidence, and report."

  - term: UltraGoal
    public: false
    replaced_by: Work
    allowed_in:
      - internal code comments
      - migration docs
      - advanced engine docs

  - term: Autopilot
    public: false
    replaced_by: Work
```

### 7.5 Example: states.yml

```yaml
states:
  - draft
  - planned
  - ready
  - running
  - blocked
  - needs_user
  - verifying
  - failed
  - completed
  - archived

transitions:
  draft: [planned]
  planned: [ready, needs_user]
  ready: [running]
  running: [blocked, needs_user, verifying, failed]
  blocked: [running, failed]
  needs_user: [planned, running, archived]
  verifying: [completed, failed]
  failed: [planned, archived]
  completed: [archived]
  archived: []
```

### 7.6 Surface Check

```bash
owx surface check
```

Checks:

```text
- default help exposes only registered public commands
- docs do not introduce unregistered public concepts
- deprecated terms do not reappear in new public docs
- state names match the lifecycle registry
- error codes have recovery actions
- JSON outputs match registered schemas
- command snapshots have not changed accidentally
- config keys are registered and documented
```

---

## 8. Core Primitive: Scope Lock

### 8.1 Purpose

Scope Lock prevents agents from wandering.

A common LLM failure mode:

```text
Fix OAuth
  → refactor config
  → add logger
  → update docs
  → create new CLI flag
  → modify unrelated tests
```

Scope Lock turns a WorkSpec into enforceable file and surface boundaries.

### 8.2 Behavior

If a worker attempts to modify a forbidden area, OWX should stop and explain:

```text
Blocked: attempted surface change

File:
- src/cli/index.ts

Reason:
- This WorkSpec does not allow public CLI changes.

Options:
1. Revise WorkSpec.
2. Move the change to an internal helper.
3. Abandon this diff.
```

### 8.3 Initial Enforcement

MVP can be simple:

```text
- compare changed files against WorkSpec file allow/deny rules
- detect package.json dependency changes
- detect docs changes
- detect surface/ changes
- detect CLI help/output changes
```

Longer term:

```text
- AST-level command/flag detection
- config key detection
- public TypeScript export detection
- state string detection
- prompt/skill public terminology detection
```

---

## 9. Core Primitive: Proof Bundle

### 9.1 Purpose

A Proof Bundle is a structured record of what was checked, what passed, what failed, and what claims are supported.

Reports should be generated from Proof Bundles, not from agent confidence.

### 9.2 Minimal Schema

```json
{
  "work_id": "work_20260630_example",
  "status": "verified",
  "changed_files": [
    "src/auth/oauth.ts",
    "tests/auth/oauth.test.ts"
  ],
  "checks": [
    {
      "name": "build",
      "command": "npm run build",
      "status": "passed",
      "evidence": "logs/build-20260630.txt"
    },
    {
      "name": "tests",
      "command": "npm test",
      "status": "passed",
      "evidence": "logs/test-20260630.txt"
    },
    {
      "name": "surface-check",
      "command": "owx surface check",
      "status": "passed"
    }
  ],
  "claims": [
    {
      "claim": "OAuth callback handles invalid state.",
      "supported_by": ["tests/auth/oauth.test.ts"]
    }
  ],
  "unverified": [
    "Production OAuth provider credentials were not configured.",
    "Browser E2E login was not executed."
  ]
}
```

### 9.3 Rules

```text
No evidence → no claim.
No check → no verified status.
No acceptance criterion → no completion claim.
No report → no durable work archive.
Unverified assumptions must be listed explicitly.
```

---

## 10. Core Primitive: Shrink Pass

### 10.1 Purpose

LLMs generate. Products require cutting.

The shrink pass runs after implementation and before final verification/reporting. Its job is to remove accidental complexity, speculative abstractions, duplicate concepts, public-surface growth, and unsupported documentation.

### 10.2 CLI

```bash
owx shrink
owx diff diet
owx harden
```

`owx shrink` can start as a review mode before it becomes an automated rewrite mode.

### 10.3 Checks

```text
- Did this change add a new public command?
- Did this change add a new public flag?
- Did this change introduce a new public concept?
- Did this change add docs that duplicate canonical docs?
- Did this change add helper functions with one callsite?
- Did this change add TODO/FIXME comments?
- Did this change modify files outside WorkSpec scope?
- Did this change add option fields that could be inferred?
- Did this change include future-proofing that is not required now?
- Did this change add claims without evidence?
```

### 10.4 Output Example

```text
Shrink Report

Removed:
- 2 unused helper functions
- 1 speculative TODO
- 1 redundant command alias

Consolidated:
- "goal", "mission", and "task objective" wording → "work"

Rejected:
- proposed --auto-magic flag
  reason: adds a user-facing decision without adding real capability

Remaining surface changes:
- none
```

---

## 11. Core Primitive: Hardness Score

### 11.1 Purpose

Hardness Score is a measurable signal for how solid a work item or release is.

It should not be a vanity score. It should help decide whether a change is ready to land.

### 11.2 Example

```text
Hardness Score: 86/100

Strong:
- 5/5 acceptance checks passed
- no public command changes
- no unregistered concepts
- report generated from proof bundle
- all errors include recovery actions

Weak:
- 1 changed file is only indirectly linked to acceptance criteria
- 2 docs sections use deprecated wording
```

### 11.3 Initial Scoring Dimensions

```text
Surface stability        public commands/flags/concepts/config/state changes
Evidence quality         checks passed, claim coverage, unverified assumptions
Scope discipline         changed files mapped to WorkSpec acceptance criteria
Documentation hygiene    no duplicate docs, runnable examples, no deprecated terms
Error recoverability     all new errors include recovery actions
Code compactness         no one-callsite abstractions, unused exports, dead files
Delegation discipline    agent boundaries respected, leader report only
```

---

## 12. Native Agent Delegation

OWX delegates independent work through Codex-native subagents. Multi-agent execution still increases slop risk, so every delegated lane needs explicit boundaries and evidence requirements.

### 12.1 Delegation Policy

Each delegated agent should receive:

```yaml
agent:
  role: backend
  allowed_files:
    - "src/auth/**"
    - "tests/auth/**"
  forbidden_files:
    - "src/cli/**"
    - "surface/**"
    - "docs/**"
  may_change_public_surface: false
  must_emit:
    - task_result
    - changed_files
    - evidence
    - blockers
```

### 12.2 Required Roles

```text
Intake Agent
  Converts natural-language intent into WorkSpec.

Planner Agent
  Decomposes WorkSpec into bounded tasks.

Executor Agent
  Implements within scope. Cannot land public surface changes.

Verifier Agent
  Runs tests/checks and collects evidence.

Surface Owner Agent
  Reviews command, flag, config, state, error, docs, and terminology changes.

Shrinker Agent
  Removes duplicate concepts, excess surface, speculative abstractions, and unsupported docs.

Reporter Agent
  Generates final report from proof bundle only.
```

### 12.3 Delegation Gates

```text
No delegated agent may change public surface directly.
No delegated agent may expand scope without WorkSpec revision.
No merge without proof bundle.
No completion without shrink pass.
No final report from individual delegated agents; leader/reporting agent only.
```

### 12.4 Native Coordination

```text
Codex owns agent spawning, messaging, waiting, interruption, and completion status.
OWX owns durable work artifacts, scope contracts, evidence, and final verification.
OWX must not recreate a second session manager or worker-state protocol.
```

---

## 13. Recommended Repository Additions

### 13.1 New Top-Level Directories

```text
surface/
  commands.yml
  concepts.yml
  states.yml
  errors.yml
  outputs.yml
  config.yml
  docs.yml
  policies.yml

schemas/
  workspec.schema.json
  proof-bundle.schema.json
  surface-change.schema.json
  report.schema.json
  lifecycle-state.schema.json

reports/
  .gitkeep
```

### 13.2 New Source Modules

```text
src/work/
  workspec.ts
  compiler.ts
  lifecycle.ts
  scope-lock.ts
  proof-bundle.ts
  report.ts
  commands.ts

src/surface/
  registry.ts
  check.ts
  diff.ts
  lint-commands.ts
  lint-concepts.ts
  lint-docs.ts
  lint-errors.ts
  lint-states.ts
  hardness.ts

src/shrink/
  diff-diet.ts
  concept-collapse.ts
  unused-surface.ts
  doc-bloat.ts
  claim-check.ts
```

### 13.3 New Tests

```text
tests/surface/
  help.snap.test.ts
  command-registry.test.ts
  concepts.test.ts
  docs-consistency.test.ts
  state-lifecycle.test.ts
  errors-recovery.test.ts

tests/work/
  workspec-compile.test.ts
  workspec-validate.test.ts
  scope-lock.test.ts
  proof-bundle.test.ts
  report-from-proof.test.ts

tests/shrink/
  diff-diet.test.ts
  unsupported-claims.test.ts
  one-callsite-helper.test.ts
```

---

## 14. Roadmap

### Phase 0 — Surface Freeze and Inventory

Goal: stop the surface from expanding until it is known.

Deliverables:

```text
- inventory all CLI commands and flags
- inventory all skills and agents by public/internal/deprecated status
- inventory all public config keys
- inventory all state strings
- inventory all docs and user-facing terminology
- capture current help output snapshots
- create initial surface/ registry files
```

Acceptance:

```text
- `owx surface check` can compare CLI help to surface/commands.yml
- default help exposes only registered commands
- deprecated/internal commands are marked explicitly
- PLAN.md is linked from future README/docs
```

Non-goals:

```text
- no new agent modes
- no new major commands
- no UI/HUD redesign yet
```

Priority: P0

---

### Phase 1 — Concept Collapse

Goal: reduce the public vocabulary.

Deliverables:

```text
- choose canonical public terms: Work, Spec, Agent, Evidence, Report, Policy, Surface
- move UltraGoal/Ralph/Autopilot/etc. to internal or advanced docs
- rewrite default help around the core commands
- make `owx list` default to active/public entries only
- add `--all` for deprecated/internal/merged entries
- add terminology lint for public docs
```

Acceptance:

```text
- a new user can explain OWX using fewer than 8 public concepts
- default help fits on one terminal screen
- docs do not introduce unregistered public concepts
```

Priority: P0

---

### Phase 2 — Documentation Baseline

Goal: create a minimal, operational doc set.

Deliverables:

```text
README.md
GETTING_STARTED.md
CONCEPTS.md
COMMANDS.md
RECIPES.md
TROUBLESHOOTING.md
SAFETY.md
```

Doc rules:

```text
- every feature doc must include when to use it, command, expected output, and failure path
- no marketing-only sections
- no duplicate conceptual explanations across docs
- every public command must have one canonical doc home
```

Acceptance:

```text
- first-run path documented from install to first verified work
- safety doc covers --madmax, auth, local state, traces, and generated artifacts
- troubleshooting doc maps common doctor/plugin/native-agent failures to recovery steps
```

Priority: P0

---

### Phase 3 — WorkSpec MVP

Goal: compile natural-language work into a contract before durable execution.

Deliverables:

```text
- schemas/workspec.schema.json
- `owx work compile`
- `owx work run`
- `owx work status`
- WorkSpec validation
- minimal lifecycle state machine
- WorkSpec preview before execution
```

Acceptance:

```text
- WorkSpec includes outcome, scope, non-goals, acceptance, allowed/forbidden files, verification
- missing acceptance criteria block completion
- large work cannot bypass WorkSpec unless explicitly forced
```

Priority: P0/P1

---

### Phase 4 — Scope Lock MVP

Goal: prevent agents from drifting outside the agreed work contract.

Deliverables:

```text
- changed-file validation against WorkSpec
- forbidden area detection: src/cli, surface, docs, package.json, state schemas
- package dependency change detection
- public surface change warning
- WorkSpec revision flow
```

Acceptance:

```text
- modifications outside allowed scope are reported before completion
- public surface changes require SurfaceChange proposal
- dependency changes require explicit approval path
```

Priority: P1

---

### Phase 5 — Surface Check MVP

Goal: make product surface drift visible and blockable.

Deliverables:

```text
- `owx surface check`
- `owx surface diff`
- command registry check
- concept drift check
- state registry check
- error recovery check
- help snapshot check
```

Acceptance:

```text
- unregistered public commands fail surface check
- docs with deprecated public terminology fail surface check
- state strings outside surface/states.yml fail surface check
- errors without recovery action are warned or failed by severity
```

Priority: P1

---

### Phase 6 — Proof Bundle and Evidence-Backed Reports

Goal: eliminate unsupported completion claims.

Deliverables:

```text
- schemas/proof-bundle.schema.json
- check result collector
- changed-file collector
- acceptance-to-evidence mapping
- `owx report --proof`
- natural-language report generated only from proof bundle
```

Acceptance:

```text
- final report lists checks, evidence, changed files, unverified assumptions, and follow-up risks
- unsupported claims are removed or downgraded
- failed checks produce recovery-oriented status
```

Priority: P1

---

### Phase 7 — Shrink Pass and Diff Diet

Goal: force LLM output through a reduction phase.

Deliverables:

```text
- `owx shrink`
- `owx diff diet`
- changed-files-to-acceptance mapper
- one-callsite helper detector
- TODO/FIXME growth detector
- public surface growth detector
- docs bloat detector
- unsupported claim detector
```

Acceptance:

```text
- substantial work cannot become completed until shrink pass runs
- shrink report lists removed, consolidated, rejected, and remaining surface changes
- speculative abstractions are flagged
- docs added without runnable example are flagged
```

Priority: P1/P2

---

### Phase 8 — Native Agent Delegation Hardening

Goal: make multi-agent work powerful without letting it tear the product surface apart.

Deliverables:

```text
- delegated-agent write boundaries
- Surface Owner role
- leader-only final report
- delegated-agent proof artifacts
- native lifecycle and recovery guidance
```

Acceptance:

```text
- delegated agents cannot directly land public surface changes
- task assignment includes allowed/forbidden paths
- merge requires verification, surface check, proof bundle, and shrink pass
- native coordination status identifies blockers and next actions
```

Priority: P2

---

### Phase 9 — Hardness Score

Goal: measure product solidity over time.

Deliverables:

```text
- `owx hardness`
- work-level hardness score
- repository-level hardness score
- release hardness score
- CI report output
```

Acceptance:

```text
- score includes surface, evidence, scope, docs, errors, code compactness, and delegation discipline
- score regressions are visible in CI
- release notes include hardness deltas
```

Priority: P2

---

### Phase 10 — Release Discipline and Distribution Cleanup

Goal: make the product installable, understandable, and safe to share.

Deliverables:

```text
- decide public npm vs private/internal vs plugin-bundle-first distribution
- resolve package `private: true` vs publish/update flows
- clean source archive script excluding .git, node_modules, .owx, __MACOSX, local logs
- `owx doctor` remediation links to docs
- plugin verification in CI
- native binary fallback documentation
```

Acceptance:

```text
- installation path is unambiguous
- shared archives do not contain local state or sensitive session artifacts
- release workflow matches distribution strategy
- README first-run path succeeds on a clean project
```

Priority: P0/P1

---

## 15. Proposed Command Evolution

### 15.1 Near-Term

Keep existing commands working, but reduce default exposure.

```text
owx help              # simple core help
owx help advanced     # full command catalog
owx list              # active/public only
owx list --all        # include internal/deprecated/merged
```

### 15.2 Mid-Term

Introduce the work/surface/report model.

```text
owx work compile "..."
owx work run
owx work status
owx work verify
owx work report
owx surface check
owx shrink
owx hardness
```

### 15.3 Long-Term

Route older modes through the newer public model.

```text
owx work --mode durable       # may use ultragoal internally
owx work --mode autopilot     # may use autopilot internally
owx work --performance        # may use performance-goal internally
```

Codex-native subagents may execute independent lanes while OWX retains the durable work contract.

Do not delete proven engines prematurely. Collapse their public presentation first.

---

## 16. Definition of Done for OWX Work

A substantial OWX work item is not done until:

```text
1. It has a WorkSpec.
2. Scope and non-goals are explicit.
3. Acceptance criteria are checkable.
4. Changed files map to the WorkSpec.
5. Required tests/checks pass or failures are documented.
6. Surface check passes or approved SurfaceChange exists.
7. Shrink pass runs.
8. Proof Bundle is generated.
9. Final report is generated from the Proof Bundle.
10. Unverified assumptions are listed.
11. Recovery steps exist for failures.
```

---

## 17. Anti-Patterns to Ban

### 17.1 “Just add a flag”

Flags should not be used to avoid product decisions. Prefer inference, policy, profiles, or internal routing.

### 17.2 “Add a new command for every workflow”

New commands must have a public-surface justification and a registry entry.

### 17.3 “The agent says it passed”

Agent assertions are not evidence. Logs, test results, diffs, and check outputs are evidence.

### 17.4 “Docs as a dumping ground”

Docs should teach the canonical path. Recipes can cover variants. Random extra docs create slop.

### 17.5 “Future-proof abstraction”

Do not add abstractions for imagined future use. Add them when there are real callsites and tests.

### 17.6 “Silent fallback”

Fallbacks must be observable when they affect behavior, quality, safety, or user expectations.

### 17.7 “Internal terms in public help”

Engine names and implementation details should not leak into the default user path.

---

## 18. Metrics

### Product Surface Metrics

```text
public command count
public flag count
public concept count
deprecated term usage
undocumented command count
registered-but-unimplemented command count
unregistered output schema count
```

### Work Quality Metrics

```text
percentage of substantial work with WorkSpec
acceptance criteria pass rate
proof bundle coverage
unsupported claim count
unverified assumption count
scope violation count
shrink findings per work item
```

### Delegation Quality Metrics

```text
delegated-agent boundary violations
blocked tasks with recovery action
merge attempts failing surface check
time from blocked to recovered
leader report evidence coverage
```

### Documentation Metrics

```text
canonical docs count
duplicate concept sections
docs without runnable examples
commands missing troubleshooting entries
safety-sensitive features missing warnings
```

---

## 19. First 10 Implementation Commits

This sequence is intentionally conservative. It creates guardrails before adding new capability.

1. **Add PLAN.md**
   Establish the product thesis and roadmap.

2. **Add `surface/commands.yml` inventory**
   Register current commands with status: core, advanced, internal, deprecated, legacy.

3. **Add `surface/concepts.yml` inventory**
   Register canonical terms and deprecated/internal terms.

4. **Add help snapshot tests**
   Detect accidental public CLI changes.

5. **Make `owx list` public-first**
   Default to active/public entries; move internal/deprecated to `--all`.

6. **Add docs baseline skeleton**
   README, GETTING_STARTED, CONCEPTS, COMMANDS, TROUBLESHOOTING, SAFETY.

7. **Add WorkSpec schema**
   Start with static validation only.

8. **Add `owx work compile` preview**
   Compile intent into WorkSpec without executing.

9. **Add `owx surface check` MVP**
   Validate command registry and concept terms.

10. **Add Proof Bundle schema and report skeleton**
   Generate a structured proof report from existing checks.

---

## 20. Open Product Decisions

These should be resolved early because they shape the surface.

1. **Distribution strategy**
   Is OWX public npm, private/internal, or plugin-bundle-first?

2. **Public name model**
   Is the product OWX, Owen Codex, or something else? Internal OMX naming should not leak.

3. **Canonical entrypoint**
   Is durable work publicized as `owx work`, `owx goal`, or something else?

4. **Native delegation policy**
   Which work may be delegated automatically, and which work requires explicit user direction?

5. **Safety posture**
   What confirmations are required for `--madmax`, auth switching, native hooks, and local state writes?

6. **Report format stability**
   Should reports be human-first Markdown, machine-first JSON, or both generated from the same Proof Bundle?

7. **State storage contract**
   What is allowed in `.owx`, and what must never be included in shared archives?

---

## 21. The Long-Term Bet

The market will get many tools that generate code with agents.

The scarce thing will not be generation.

The scarce thing will be **trustworthy consolidation**:

```text
Did the agent stay in scope?
Did it change public behavior?
Did it invent a new concept?
Did it prove its claims?
Did it leave the product simpler or more chaotic?
Can a human recover from failure?
Can the next agent continue without guessing?
```

OWX should own that layer.

The ambitious roadmap is therefore not “more agents.” It is:

```text
WorkSpec
Surface Registry
Scope Lock
Proof Bundle
Shrink Pass
Hardness Score
Surface Owner
Recovery-Oriented State
```

Together, these turn OWX into a system that makes AI-generated work feel less like a pile of plausible output and more like a controlled software delivery process.

---

## 22. Final Target State

A mature OWX session should look like this:

```text
$ owx work "add OAuth login"

Compiled WorkSpec:
- outcome: add external OAuth login
- non-goals: account linking, production credential setup, multi-provider UI
- acceptance: 5 checks
- allowed files: src/auth/**, src/routes/**, tests/auth/**
- forbidden surface changes: CLI, config schema, docs terminology

Execution:
- planner created 4 tasks
- executor completed 4 tasks
- verifier ran 5 checks
- surface check passed
- shrink pass removed 2 speculative helpers

Status: completed, locally verified

Evidence:
- build passed
- tests passed
- callback failure path tested
- no public surface drift

Unverified:
- real provider credentials
- browser E2E login

Report:
- reports/work_20260630_oauth.md
- reports/work_20260630_oauth.proof.json
```

That is the desired product feel: powerful, but bounded; automated, but evidence-backed; ambitious, but disciplined.
