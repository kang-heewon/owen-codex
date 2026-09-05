import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../../');

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf-8');
}

function assertMatchesAll(content: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    assert.match(content, pattern);
  }
}

function assertCanonicalPluginParity(path: string): void {
  const pluginPath = `plugins/owen-codex/${path}`;
  assert.ok(existsSync(join(repoRoot, pluginPath)), `${pluginPath} must exist in the plugin mirror`);
  assert.equal(read(pluginPath), read(path), `${path} must match the plugin mirror exactly`);
}

const antiSlopWorkingAgreementPatterns = [
  /^## Working agreements$/m,
  /user-requested cleanup\/refactor\/deslop[\s\S]{0,120}cleanup plan[\s\S]{0,180}automatic finalization[\s\S]{0,120}reuses the owning workflow's verification/i,
  /^- Prefer deletion, existing utilities, and existing patterns before new abstractions; add dependencies only when explicitly requested\.$/m,
  /^- Keep diffs small, reviewable, and reversible\.$/m,
  /^- Do not add runtime behavior, product features, public APIs, CLI flags, UI controls, schema fields, or other shipped interfaces solely to enable or simplify verification\. Use tests, fixtures, test-only harnesses, internal dependency-injection seams, or existing supported observability and interfaces instead; any test-only surface must stay outside shipped artifacts and the product contract\.$/m,
  /Select tests, lint, typecheck, and static analysis according to the changed contract and repository requirements/,
  /Reuse passing evidence for unchanged inputs/,
];

const antiSlopWorkflowPatterns = [
  /^Anti-slop workflow:$/m,
  /Execute scoped cleanup\/refactor\/deslop work directly with a cleanup plan and the needed behavior locks/,
  /Use `\$deep-interview` only for material ambiguity/,
  /`\$ultragoal` or `\$ralph` when the user selects that execution workflow/,
  /direct material authored-source change[\s\S]{0,160}targeted verification[\s\S]{0,160}one automatic-finalization `ai-slop-cleaner` pass[\s\S]{0,160}rerun affected verification/i,
  /a no-op pass reuses the passing evidence/,
  /Explicit cleanup tasks[\s\S]{0,120}cleanup plan and behavior lock[\s\S]{0,160}Automatic finalization reuses existing verification[\s\S]{0,160}narrow test/i,
  /Exactly one active workflow owns final code cleanup[\s\S]{0,180}Ralph[\s\S]{0,80}Ultragoal[\s\S]{0,80}Autopilot/i,
  /^- Limit automatic finalization to one pass per stable candidate revision\./m,
  /^- If a cleaner change causes a regression, repair or revert that cleaner-induced change and rerun the affected verification\./m,
  /^- Prefer deletion over addition, and prefer reuse plus boundary repair over new layers\.$/m,
  /^- No new dependencies without explicit request\.$/m,
  /Run only the validation selected by the changed contract and repository requirements/,
  /Repeat a passing check only after relevant inputs change or a new failure or coverage gap justifies it/,
  /^- Keep writer\/reviewer pass separation for cleanup plans and approvals; preserve writer\/reviewer pass separation explicitly\.$/m,
];

const aiSlopCleanerWorkflowPatterns = [
  /^Reduce AI-generated slop with a cleanup profile that matches the caller's intent while preserving behavior and raising signal quality\.$/m,
  /^## Scoped File Lists and Ralph Workflow$/m,
  /^- This skill can accept a \*\*file list scope\*\* instead of a whole feature area\.$/m,
  /^- In the \*\*Ralph workflow\*\*, the mandatory deslop pass should run this skill on Ralph's changed files only, using the automatic finalization profile unless the caller explicitly requests the explicit cleanup profile\.$/m,
  /^### Explicit cleanup profile$/m,
  /^### Automatic finalization profile$/m,
  /Reuse the behavior locks and verification commands already established by the parent workflow/i,
  /Do not add or rerun redundant pre-cleaner tests/i,
  /behavior-sensitive cleanup candidate lacks coverage/i,
  /at most one cleanup pass for each stable final candidate/i,
  /Do not introduce dependencies, broaden architecture, create speculative abstractions/i,
  /cleanup as subordinate to correctness/i,
  /repair that edit or revert only that cleaner-induced change/i,
  /passed no-op when the changed files contain no justified cleanup candidate/i,
  /^1\. \*\*Lock behavior with regression tests first\*\*$/m,
  /^   - For fallback-like code, cover the primary path and any preserved compatibility\/fail-safe fallback before cleanup$/m,
  /^2\. \*\*Create a cleanup plan before code\*\*$/m,
  /^   - Include fallback findings, classifications, and escalation status in the plan$/m,
  /^3\. \*\*Inventory fallback-like code before editing\*\*$/m,
  /^   - Search the requested scope for fallback-like detection signals: quick hacks?, temporary workaround, temporary fallback, just bypass, just skip, fallback if it fails, swallowed errors, silent defaults, broad compatibility shims, and duplicate alternate execution paths$/m,
  /^   - Classify each finding before changing it:$/m,
  /^     - \*\*Masking fallback slop\*\* — hides errors or evidence, bypasses the primary contract, suppresses tests or validation, swallows failures, silently defaults, or adds untested alternate paths$/m,
  /^     - \*\*Grounded compatibility\/fail-safe fallback\*\* — is scoped to an external\/version\/fail-safe boundary, documents the rationale, preserves failure evidence, and has regression tests for both the primary and fallback behavior$/m,
  /^   - Prefer root-cause repair, deletion, boundary repair, or explicit failure behavior before preserving fallback paths$/m,
  /^   - For broad, ambiguous, cross-layer, or architectural fallback-like code, invoke `\$ralplan` for consensus resolution before edits$/m,
  /^   - Recursion guard: when already inside ralplan, ralph, ultragoal, or another OWX workflow, do not spawn a nested `\$ralplan`; record the finding and attach it to the active workflow or plan handoff instead$/m,
  /^4\. \*\*Categorize issues before editing\*\*$/m,
  /^   - \*\*Fallback-like code\*\* — masking fallbacks, workaround branches, bypasses, swallowed errors, silent defaults, broad shims, alternate execution paths$/m,
  /^   - \*\*Duplication\*\* — repeated logic, copy-paste branches, redundant helpers$/m,
  /^   - \*\*Dead code\*\* — unused code, unreachable branches, stale flags, debug leftovers$/m,
  /^   - \*\*Needless abstraction\*\* — pass-through wrappers, speculative indirection, single-use helper layers$/m,
  /^   - \*\*Boundary violations\*\* — hidden coupling, leaky responsibilities, wrong-layer imports or side effects$/m,
  /^   - \*\*UI\/design slop\*\* — review visual outputs as context-sensitive signals, not absolute bans; preserve intentional brand, design-system, accessibility, or product-context exceptions when the rationale is clear$/m,
  /^     - Korean body text that is too small: challenge 11-12px body copy; Korean body text generally needs 14px or larger unless a dense, accessible system explicitly supports smaller text$/m,
  /^     - Gratuitous depth: avoid putting box shadows on every logo, surface, card, icon, background, and step block when hierarchy or affordance does not need it$/m,
  /^     - Repetitive content scaffolding: trim repeated eyebrow \+ title \+ description \+ paragraph stacks, filler explanation text, and generic emoji badges that do not add meaning$/m,
  /^     - Default AI palettes: question blue\/purple defaults such as #3B82F6 when there is no brand, semantic, or system rationale$/m,
  /^     - Over-perfect grids: avoid reflexive uniform 3-column or 4-column card grids when the product context would benefit from rhythm, asymmetry, carousel cuts, bento composition, or varied emphasis$/m,
  /^     - Extreme gradients: tone down "AI demo" gradients unless the brand or campaign intentionally calls for that intensity$/m,
  /^5\. \*\*Execute passes one smell at a time\*\*$/m,
  /^   - \*\*Fallback-like code resolution gate\*\* — remove masking fallback slop, repair root causes, or escalate ambiguous cases before continuing$/m,
  /^   - \*\*Pass 1: Dead code deletion\*\*$/m,
  /^   - \*\*Pass 2: Duplicate removal\*\*$/m,
  /^   - \*\*Pass 3: Naming\/error handling cleanup\*\*$/m,
  /^   - \*\*Pass 4: Test reinforcement\*\*$/m,
  /^6\. \*\*Run quality gates\*\*$/m,
  /^   - Regression tests stay green$/m,
  /^   - Static\/security scan passes when available$/m,
  /^7\. \*\*Finish with an evidence-dense report\*\*$/m,
  /^   - Changed files$/m,
  /^   - Fallback findings, classifications, and escalation status$/m,
  /^   - Remaining risks$/m,
];

describe('anti-slop workflow surfaces', () => {
  it('adds durable anti-slop guidance to AGENTS surfaces', () => {
    const templateContent = read('templates/AGENTS.md');
    assertMatchesAll(templateContent, antiSlopWorkingAgreementPatterns);
    assertMatchesAll(templateContent, antiSlopWorkflowPatterns);

    if (existsSync(join(repoRoot, 'AGENTS.md'))) {
      const content = read('AGENTS.md');
      if (/^## Working agreements$/m.test(content)) {
        assertMatchesAll(content, antiSlopWorkingAgreementPatterns);
      }
    }
  });

  it('documents reviewer-only separation in review and plan review mode', () => {
    assertCanonicalPluginParity('skills/plan/SKILL.md');

    const reviewSkill = read('skills/review/SKILL.md');
    const planSkill = read('skills/plan/SKILL.md');

    assertMatchesAll(reviewSkill, [
      /Hard-deprecated/i,
      /Do not invoke or route this skill/i,
      /Use `\$code-review` directly/i,
    ]);

    assertMatchesAll(planSkill, [
      /### Review Mode \(`--review`\)/,
      /reviewer-only\s+pass/i,
      /MUST\s+NOT\s+be\s+the\s+context\s+that\s+approves\s+it/i,
      /cleanup\s+plan,\s*regression\s+tests/i,
    ]);
  });

  it('defines the built-in ai-slop-cleaner workflow', () => {
    const skill = read('skills/ai-slop-cleaner/SKILL.md');
    const pluginSkill = read('plugins/owen-codex/skills/ai-slop-cleaner/SKILL.md');
    assert.equal(pluginSkill, skill);
    assertMatchesAll(skill, aiSlopCleanerWorkflowPatterns);
    assert.match(skill, /regression tests first/i);
    assert.match(skill, /cleanup plan/i);
    assert.match(skill, /duplication/i);
    assert.match(skill, /dead code/i);
    assert.match(skill, /needless abstraction/i);
    assert.match(skill, /boundary violations/i);
    assert.match(skill, /UI\/design slop/i);
    assert.match(skill, /Korean body text/i);
    assert.match(skill, /11-12px/);
    assert.match(skill, /14px or larger/);
    assert.match(skill, /box shadows/i);
    assert.match(skill, /eyebrow \+ title \+ description \+ paragraph/i);
    assert.match(skill, /generic emoji badges/i);
    assert.match(skill, /#3B82F6/);
    assert.match(skill, /3-column or 4-column card grids/i);
    assert.match(skill, /rhythm, asymmetry/i);
    assert.match(skill, /Extreme gradients/i);
    assert.match(skill, /intentional brand, design-system, accessibility, or product-context exceptions/i);
    assert.match(skill, /Pass 1: Dead code deletion/i);
    assert.match(skill, /Pass 2: Duplicate removal/i);
    assert.match(skill, /Pass 3: Naming\/error handling cleanup/i);
    assert.match(skill, /Pass 4: Test reinforcement/i);
    assert.match(skill, /quality gates/i);
    assert.match(skill, /remaining risks/i);
    assert.match(skill, /file list scope/i);
    assert.match(skill, /changed files/i);
    assert.match(skill, /Ralph workflow/i);
    assert.match(skill, /fallback-like (?:inventory|detection|code)/i);
    assert.match(skill, /quick hack/i);
    assert.match(skill, /temporary workaround/i);
    assert.match(skill, /temporary fallback/i);
    assert.match(skill, /just bypass/i);
    assert.match(skill, /fallback if it fails/i);
    assert.match(skill, /swallowed errors/i);
    assert.match(skill, /silent defaults/i);
    assert.match(skill, /broad compatibility shims/i);
    assert.match(skill, /alternate execution paths/i);
    assert.match(skill, /Masking fallback slop/i);
    assert.match(skill, /Grounded compatibility\/fail-safe fallback/i);
    assert.match(skill, /root-cause repair/i);
    assert.match(skill, /explicit failure behavior/i);
    assert.match(skill, /\$ralplan/);
    assert.match(skill, /consensus resolution/i);
    assert.match(skill, /Recursion guard/i);
    assert.match(skill, /do not spawn a nested `?\$ralplan`?/i);
    assert.match(skill, /active workflow/i);
    assert.match(skill, /Fallback Findings/i);
    assert.match(skill, /classifications/i);
    assert.match(skill, /escalation status/i);
  });

  it('keeps final cleanup single-owner and reviews the cleaned verified diff', () => {
    const ralph = read('skills/ralph/SKILL.md');
    const ultragoal = read('skills/ultragoal/SKILL.md');
    const autopilot = read('skills/autopilot/SKILL.md');
    const codeSimplifier = read('src/hooks/code-simplifier/index.ts');

    const ralphStages = [
      '6. **Verify the stable final candidate with fresh evidence**',
      '7.5 **Mandatory Deslop Pass**',
      '7.6 **Regression Re-verification**',
      '8. **Final architect verification of the exact cleaned diff**',
      '9. **Completion audit**',
    ].map((stage) => ralph.indexOf(stage));
    assert.ok(ralphStages.every((index) => index >= 0));
    assert.deepEqual([...ralphStages].sort((a, b) => a - b), ralphStages);
    assert.match(ralph, /Any source change after approval makes that approval stale/i);
    assert.match(ralph, /new finalization cycle at Step 6/i);
    assert.match(ralph, /Do not blindly rerun the cleaner in a loop/i);

    assert.match(ultragoal, /ai-slop-cleaner` exactly once for that candidate/i);
    assert.match(ultragoal, /independent review path on the exact post-clean diff/i);
    assert.match(ultragoal, /do not blindly loop the cleaner/i);
    assert.match(ultragoal, /new stable final candidate and run one new Steps 1-4 cycle/i);

    assert.match(autopilot, /must not run an additional parent-level `ai-slop-cleaner` pass/i);
    assert.match(codeSimplifier, /Disabled by default — requires explicit opt-in/i);
  });
});
