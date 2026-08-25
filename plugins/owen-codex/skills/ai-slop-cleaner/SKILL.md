---
name: ai-slop-cleaner
description: Run an anti-slop cleanup/refactor/deslop workflow
---

# AI Slop Cleaner Skill

Reduce AI-generated slop with a cleanup profile that matches the caller's intent while preserving behavior and raising signal quality.

## When to Use

Use this skill when:
- A code path works but feels bloated, noisy, repetitive, or over-abstracted
- A user asks to “cleanup”, “refactor”, or “deslop” AI-generated output
- Follow-up implementation left duplicate code, dead code, weak boundaries, missing tests, fallback-like code, or unnecessary wrapper layers
- You need a disciplined cleanup workflow without broad rewrites

## GPT-5.5 Guidance Alignment

- Keep outputs concise and evidence-dense unless risk or the user requests more detail.
- Treat newer user instructions as local workflow updates without discarding earlier non-conflicting constraints.
- Keep using inspection, tests, diagnostics, and verification until the cleanup is grounded.
- Proceed automatically through clear, reversible cleanup steps; ask only when a choice materially changes scope or behavior.

## Scoped File Lists and Ralph Workflow

- This skill can accept a **file list scope** instead of a whole feature area.
- When the caller provides a changed-files list (for example, Ralph session-owned edits), keep the cleanup strictly bounded to those files.
- In the **Ralph workflow**, the mandatory deslop pass should run this skill on Ralph's changed files only, using the automatic finalization profile unless the caller explicitly requests the explicit cleanup profile.

## Choose a Profile

### Explicit cleanup profile

Use this profile when the user directly asks to clean up, refactor, or deslop code. It is a planned cleanup workflow: lock behavior, write a cleanup plan, inventory fallback and UI/design findings, then execute one verified smell pass at a time. Follow the full procedure below.

### Automatic finalization profile

Use this profile when a parent OWX workflow or direct coding workflow invokes the cleaner as a final quality gate after implementation is stable. This is a bounded final-candidate review, not a new refactor project.

1. Scope the review to the caller's changed-files list. If the caller does not provide one, derive it from the current task's owned diff; do not include unrelated worktree changes.
2. Reuse the behavior locks and verification commands already established by the parent workflow. Record a concise inventory of relevant cleanup, fallback-like, and UI/design findings in the changed files.
3. Do not add or rerun redundant pre-cleaner tests. Add the narrowest regression coverage first only when a behavior-sensitive cleanup candidate lacks coverage needed to prove preservation. A grounded compatibility/fail-safe fallback remains behavior-sensitive and requires coverage of both primary and fallback behavior before it is changed.
4. Make at most one cleanup pass for each stable final candidate. Prefer deletion, reuse, boundary repair, and explicit failure. Do not introduce dependencies, broaden architecture, create speculative abstractions, or absorb deferred findings into the finalization scope.
5. Treat cleanup as subordinate to correctness. After edits, rerun the existing relevant verification set. If a cleaner edit causes a regression, repair that edit or revert only that cleaner-induced change, then rerun the verification affected by the repair. Do not blindly repeat an unchanged failing command without changing the candidate or diagnosis.
6. Report a passed no-op when the changed files contain no justified cleanup candidate. Record broad, ambiguous, cross-layer, or architectural findings for the parent workflow instead of expanding scope or starting a nested planning workflow.

The automatic finalization profile stops when every accepted stable candidate has received one pass and the relevant post-cleaner verification is green, or when a no-op inventory finds no justified candidate. It also stops without changing the candidate when preservation cannot be proved inside the changed-files scope; report that finding to the parent workflow. A cleaner-induced regression is not a valid stopping state: repair or revert the cleaner change and obtain fresh passing evidence.

## Explicit Cleanup Procedure

1. **Lock behavior with regression tests first**
   - Identify the behavior that must not change
   - Add or run targeted regression tests before editing cleanup candidates
   - If behavior is currently untested, create the narrowest test coverage needed first
   - For fallback-like code, cover the primary path and any preserved compatibility/fail-safe fallback before cleanup

2. **Create a cleanup plan before code**
   - List the specific smells to remove
   - Bound the pass to the requested files/scope
   - If a file list scope is provided, keep the pass restricted to that changed-files list
   - Include fallback findings, classifications, and escalation status in the plan
   - Order fixes from safest/highest-signal to riskiest
   - Do not start coding until the cleanup plan is explicit

3. **Inventory fallback-like code before editing**
   - Search the requested scope for fallback-like detection signals: quick hacks, temporary workaround, temporary fallback, just bypass, just skip, fallback if it fails, swallowed errors, silent defaults, broad compatibility shims, and duplicate alternate execution paths
   - Classify each finding before changing it:
     - **Masking fallback slop** — hides errors or evidence, bypasses the primary contract, suppresses tests or validation, swallows failures, silently defaults, or adds untested alternate paths
     - **Grounded compatibility/fail-safe fallback** — is scoped to an external/version/fail-safe boundary, documents the rationale, preserves failure evidence, and has regression tests for both the primary and fallback behavior
   - Prefer root-cause repair, deletion, boundary repair, or explicit failure behavior before preserving fallback paths
   - For broad, ambiguous, cross-layer, or architectural fallback-like code, invoke `$ralplan` for consensus resolution before edits
   - Recursion guard: when already inside ralplan, ralph, ultragoal, or another OWX workflow, do not spawn a nested `$ralplan`; record the finding and attach it to the active workflow or plan handoff instead

4. **Categorize issues before editing**
   - **Fallback-like code** — masking fallbacks, workaround branches, bypasses, swallowed errors, silent defaults, broad shims, alternate execution paths
   - **Duplication** — repeated logic, copy-paste branches, redundant helpers
   - **Dead code** — unused code, unreachable branches, stale flags, debug leftovers
   - **Needless abstraction** — pass-through wrappers, speculative indirection, single-use helper layers
   - **Boundary violations** — hidden coupling, leaky responsibilities, wrong-layer imports or side effects
   - **UI/design slop** — review visual outputs as context-sensitive signals, not absolute bans; preserve intentional brand, design-system, accessibility, or product-context exceptions when the rationale is clear
     - Korean body text that is too small: challenge 11-12px body copy; Korean body text generally needs 14px or larger unless a dense, accessible system explicitly supports smaller text
     - Gratuitous depth: avoid putting box shadows on every logo, surface, card, icon, background, and step block when hierarchy or affordance does not need it
     - Repetitive content scaffolding: trim repeated eyebrow + title + description + paragraph stacks, filler explanation text, and generic emoji badges that do not add meaning
     - Default AI palettes: question blue/purple defaults such as #3B82F6 when there is no brand, semantic, or system rationale
     - Over-perfect grids: avoid reflexive uniform 3-column or 4-column card grids when the product context would benefit from rhythm, asymmetry, carousel cuts, bento composition, or varied emphasis
     - Extreme gradients: tone down "AI demo" gradients unless the brand or campaign intentionally calls for that intensity
   - **Missing tests** — behavior not locked, weak regression coverage, gaps around edge cases

5. **Execute passes one smell at a time**
   - **Fallback-like code resolution gate** — remove masking fallback slop, repair root causes, or escalate ambiguous cases before continuing
   - **Pass 1: Dead code deletion**
   - **Pass 2: Duplicate removal**
   - **Pass 3: Naming/error handling cleanup**
   - **Pass 4: Test reinforcement**
   - Re-run targeted verification after each pass
   - Avoid bundling unrelated refactors into the same edit set

6. **Run quality gates**
   - Regression tests stay green
   - Lint passes
   - Typecheck passes
   - Relevant unit/integration tests pass
   - Static/security scan passes when available
   - Diff stays minimal and scoped
   - No new abstractions or dependencies unless explicitly required

7. **Finish with an evidence-dense report**
   - Changed files
   - Simplifications made
   - Fallback findings, classifications, and escalation status
   - Tests/diagnostics/build checks run
   - UI/design reviewer checklist findings when visual/UI files were in scope
   - Remaining risks
   - Residual follow-ups or consciously deferred cleanup

The explicit cleanup profile stops when the planned smell passes are complete, all applicable quality gates pass, and remaining findings are explicitly deferred or escalated. If a proposed cleanup would require architectural expansion or cannot preserve behavior within the approved scope, leave it unchanged and report the blocker or handoff. Never stop with a cleaner-induced regression; repair or revert the cleanup change first.

## Output Format

Use the detailed report for the explicit cleanup profile:

```text
AI SLOP CLEANUP REPORT
======================

Scope: [files or feature area]
Behavior Lock: [targeted regression tests added/run]
Cleanup Plan: [bounded smells and order]
Fallback Findings: [none, or finding -> masking fallback slop / grounded compatibility/fail-safe fallback -> escalation status]
UI/Design Findings: [none/N/A, or signal -> action taken/deferred -> intentional exception rationale]

Passes Completed:
- Fallback-like code resolution gate - [root-cause repair, explicit failure behavior, preserved grounded fallback, or ralplan handoff]
1. Pass 1: Dead code deletion - [concise fix]
2. Pass 2: Duplicate removal - [concise fix]
3. Pass 3: Naming/error handling cleanup - [concise fix]
4. Pass 4: Test reinforcement - [concise fix]

Quality Gates:
- Regression tests: PASS/FAIL
- Lint: PASS/FAIL
- Typecheck: PASS/FAIL
- Tests: PASS/FAIL
- Static/security scan: PASS/FAIL or N/A

Changed Files:
- [path] - [simplification]

Fallback Review:
- Findings: [fallback-like findings detected]
- Classification: [masking fallback slop | grounded fallback]
- Escalation Status: [none | raised to leader/ralplan | no escalation]

Remaining Risks:
- [none or short deferred item]
```

For the automatic finalization profile, keep the report concise:

```text
AI SLOP FINALIZATION REPORT
===========================

Scope: [changed files only]
Inventory: [accepted candidates, deferred findings, or no-op]
Cleanup: [one-pass simplifications, or no changes]
Fallback/UI Review: [concise classifications and actions, or N/A]
Verification Reused: [existing commands/behavior locks]
Post-Cleaner Verification: [PASS/FAIL with fresh evidence]
Stop Condition: [candidates completed and green | passed no-op | preservation blocker handed off]
```

## Scenario Examples

**Good:** The user says `continue` after tests already lock behavior and the next smell pass is clear. Continue with the next bounded cleanup pass.

**Good:** The user narrows the scope to a specific file after planning. Keep the regression-tests-first workflow, but apply the new scope locally.

**Bad:** Start rewriting architecture before protecting behavior with tests.

**Bad:** Collapse multiple smell categories into one large refactor with no intermediate verification.

**Bad:** Keep a `fallback if it fails` branch that silently defaults after a swallowed error instead of fixing the root cause or making failure explicit.

**Good:** A version-specific compatibility shim is narrow, documented, preserves error evidence, has primary and fallback regression tests, and is reported as a grounded compatibility/fail-safe fallback.
