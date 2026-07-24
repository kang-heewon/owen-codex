import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AGENT_DEFINITIONS } from '../../agents/definitions.js';
import { KEYWORD_TRIGGER_DEFINITIONS } from '../keyword-registry.js';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const skillDir = join(repoRoot, 'skills', 'prometheus-strict');
const skillPath = join(skillDir, 'SKILL.md');
const readmePath = join(skillDir, 'README.md');
const promptNames = [
  'prometheus-strict-metis',
  'prometheus-strict-momus',
  'prometheus-strict-oracle',
] as const;
const promptRoles = {
  'prometheus-strict-metis': 'METIS',
  'prometheus-strict-momus': 'MOMUS',
  'prometheus-strict-oracle': 'ORACLE',
} as const;

function readRepoFile(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('prometheus-strict clean-room contract', () => {
  it('does not add a prometheus-strict hook runtime or Sisyphus/start-work port', () => {
    const hookRegistry = readRepoFile(join(repoRoot, 'src', 'hooks', 'keyword-registry.ts'));
    assert.doesNotMatch(hookRegistry, /start-work|Sisyphus/i, 'keyword wiring must not port start-work or Sisyphus behavior');

    for (const hookPath of [
      join(repoRoot, 'src', 'hooks', 'prometheus-strict.ts'),
      join(repoRoot, 'src', 'scripts', 'prometheus-strict-hook.ts'),
    ]) {
      assert.equal(existsSync(hookPath), false, `${hookPath} must not exist`);
    }
  });

  it('ships the Metis, Momus, and Oracle prompts with distinct planning contracts', () => {
    assert.ok(existsSync(skillPath), 'prometheus-strict skill must exist');

    for (const promptName of promptNames) {
      const promptPath = join(repoRoot, 'prompts', `${promptName}.md`);
      assert.ok(existsSync(promptPath), `${promptName} prompt must exist`);
      const content = readRepoFile(promptPath);

      assert.match(content, /clean-room/i, `${promptName} must preserve clean-room guidance`);
      assert.match(content, /Do not copy or imitate OMO wording, source, prompts, or runtime behavior/i, `${promptName} must block source copying`);
      assert.match(content, /do not implement code|do not implement|Produce a plan, not implementation/i, `${promptName} must not implement`);
      assert.match(content, /output_contract/i, `${promptName} must define an output contract`);

      for (const section of [
        'identity',
        'goal',
        'constraints',
        'scope_guard',
        'ask_gate',
        'execution_loop',
        'success_criteria',
        'tools',
        'style',
        'output_contract',
      ]) {
        assert.match(content, new RegExp(`<${section}>`), `${promptName} must include <${section}>`);
        assert.match(content, new RegExp(`</${section}>`), `${promptName} must close </${section}>`);
      }

      const role = promptRoles[promptName];
      assert.match(content, new RegExp(`OWX:GUIDANCE:${role}:CONSTRAINTS:START`), `${promptName} must include constraints guidance start marker`);
      assert.match(content, new RegExp(`OWX:GUIDANCE:${role}:CONSTRAINTS:END`), `${promptName} must include constraints guidance end marker`);
      assert.match(content, new RegExp(`OWX:GUIDANCE:${role}:OUTPUT:START`), `${promptName} must include output guidance start marker`);
      assert.match(content, new RegExp(`OWX:GUIDANCE:${role}:OUTPUT:END`), `${promptName} must include output guidance end marker`);
    }

    assert.match(readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md')), /Metis Clarification/i);
    assert.match(readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-momus.md')), /Momus Critique/i);
    assert.match(readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-oracle.md')), /Prometheus Strict Plan/i);
  });

  it('enforces the Metis background research fan-out contract', () => {
    const metis = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md'));

    assert.match(metis, /<research_fan_out>[\s\S]+<\/research_fan_out>/, 'metis must include a research_fan_out block');
    assert.match(metis, /subagent_type="researcher"/, 'metis research_fan_out must name the researcher subagent');
    assert.match(metis, /subagent_type="explore"/, 'metis research_fan_out must name the explore subagent');
    assert.match(metis, /run_in_background=true/, 'metis research_fan_out must require background dispatch');
    assert.match(metis, /Max\s*\*\*2 explore \+ 4 researcher\*\*/, 'metis research_fan_out must cap the parallel budget at 2 explore + 4 researcher');
    for (const marker of ['\\[CONTEXT\\]', '\\[GOAL\\]', '\\[DOWNSTREAM\\]', '\\[REQUEST\\]']) {
      assert.match(metis, new RegExp(marker), `metis research_fan_out must require the ${marker.replace(/\\\[|\\\]/g, '')} prompt section`);
    }
    assert.match(metis, /gpt-5\.4-mini[\s\S]{0,120}researcher/i, 'metis research_fan_out must document researcher as the exact cheap mini lane');
    assert.match(metis, /official docs[\s\S]{0,120}release notes\/changelog[\s\S]{0,160}OSS reference implementations[\s\S]{0,120}pitfalls\/migration notes/i, 'metis research_fan_out must split multiple researcher requests by evidence lane');
    assert.match(metis, /Wait for every dispatched agent to complete/i, 'metis research_fan_out must block on agent completion before generating questions');
    assert.match(metis, /Re-run `<spec_prefill>`/i, 'metis research_fan_out must feed results back into spec_prefill');
    assert.match(metis, /trivial[\s\S]{0,40}skip fan-out/i, 'metis research_fan_out must skip for trivial intent');
    assert.match(metis, /research[\s\S]{0,120}(?:minimum|REQUIRES)[\s\S]{0,80}2 researcher/i, 'metis research_fan_out must require at least 2 researcher lanes for research intent');
    assert.match(metis, /STRONGLY PREFER/i, 'metis research_fan_out must STRONGLY PREFER for build-from-scratch and architecture intents');

    assert.match(metis, /3\.\s*\*\*Run\s*`<research_fan_out>`\*\*[\s\S]{0,260}budget 2 explore \+ 4 researcher max/i, 'metis execution_loop must invoke research_fan_out as step 3 with the 2 explore + 4 researcher budget');
    assert.doesNotMatch(metis, /2 \+ 2 max|2 explore \+ 2 researcher/i, 'metis must not retain stale 2+2 fan-out budget wording');
  });

  it('researcher subagent referenced by Metis fan-out absorbs OMO librarian-shape capability', () => {
    const researcher = readRepoFile(join(repoRoot, 'prompts', 'researcher.md'));
    const metis = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md'));

    assert.match(researcher, /<repo_research>[\s\S]+<\/repo_research>/, 'researcher must declare a <repo_research> block to back metis cross-repo OSS lookups');
    assert.match(researcher, /gh search code/i, 'researcher must enumerate gh search code for cross-repo OSS discovery');
    assert.match(researcher, /raw\.githubusercontent\.com|gh api repos\/<org>\/<repo>/i, 'researcher must allow pinned-SHA OSS file fetches');
    assert.match(researcher, /Context7 MCP/i, 'researcher must reference Context7 MCP with a graceful web fallback');
    assert.match(researcher, /org\/repo@sha:path/i, 'researcher must specify the org/repo@sha:path:line citation format');
    assert.match(researcher, /OSS Reference Implementations/, 'researcher output_contract must include the OSS Reference Implementations section');

    assert.match(metis, /org\/repo@sha:file:line/, 'metis research_fan_out must declare the org/repo@sha:file:line citation form, coupling researcher OSS contract to prometheus fan-out');
  });

  it('enforces the Metis intent-classification, spec-prefill, self-review, and stale-rule cleanup contract', () => {
    const metis = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md'));

    assert.match(metis, /<intent_classification>[\s\S]+<\/intent_classification>/, 'metis must include an intent_classification block');
    for (const family of ['trivial', 'simple', 'refactor', 'build-from-scratch', 'research', 'spec-driven', 'test-infra', 'architecture', 'collaboration']) {
      assert.match(
        metis,
        new RegExp(`\\*\\*${family.replace('-', '[-\\s]')}\\*\\*`, 'i'),
        `metis intent_classification must declare the ${family} family`,
      );
    }

    assert.match(metis, /No interview at all|skip the interview entirely/i, 'metis must explicitly skip the interview for trivial tasks');
    assert.match(metis, /at most 1-2|1-2 targeted questions/i, 'metis must cap simple-intent interviews at 1-2 questions');

    assert.match(metis, /<spec_prefill>[\s\S]+<\/spec_prefill>/, 'metis must include a spec_prefill block');
    for (const signal of ['PRD', 'RFC', 'issue', 'package\\.json', 'Cargo\\.toml']) {
      assert.match(metis, new RegExp(signal, 'i'), `metis spec_prefill must recognise ${signal} as a spec signal`);
    }
    assert.match(metis, /docs\/specs|docs\/rfcs/, 'metis spec_prefill must mention the canonical repo-local spec directories');

    assert.match(metis, /<self_review>[\s\S]+<\/self_review>/, 'metis must include a self_review block');
    assert.match(metis, /seven gates of <question_quality>|all seven gates/i, 'metis self_review must re-check the seven question_quality gates');
    assert.match(metis, /Self-review is a hard prerequisite/i, 'metis self_review must declare itself a hard prerequisite for emitting a round');

    assert.doesNotMatch(metis, /Blocking questions are limited to one at a time/i, 'metis success_criteria must drop the stale single-question rule that contradicted the batch + multi-round contract');
    assert.match(metis, /Intent family is declared and the round's question slate matches that family/i, 'metis success_criteria must reflect the intent-classification gate');
    assert.match(metis, /never by subjective[\s\S]{0,30}feels enough/i, 'metis success_criteria must explicitly reject subjective termination');
  });

  it('removes the three concrete over-asking contradictions observed in the 2026-05-22 prometheus-strict trace', () => {
    const metis = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md'));

    assert.match(metis, /<tools>[\s\S]*?subagent_type[\s\S]*?<\/tools>/, 'metis <tools> block must explicitly grant task(subagent_type=...) dispatch permission so the research_fan_out block is reachable');
    assert.match(metis, /<tools>[\s\S]*?(?:explore|researcher)[\s\S]*?<\/tools>/i, 'metis <tools> block must enumerate the explore/researcher subagent dispatch path');

    assert.doesNotMatch(metis, /###\s*Open Question[\s\S]{0,80}Ask one question only/i, 'metis <output_contract> must drop the stale "Ask one question only" line that contradicted the batch + multi-round ask_gate');
    assert.match(metis, /###\s*Questions Emitted This Round|Questions This Round|Round Questions|0\s*-\s*N questions|zero or more questions/i, 'metis <output_contract> must replace the single-question section with a multi-question round section');

    assert.match(metis, /vague[\s\S]{0,60}verb|short[\s\S]{0,40}ambiguous|under[\s\S]{0,20}\d+\s*words/i, 'metis <intent_classification> must declare an anti-over-classification rule for short/vague task inputs');
    assert.match(metis, /(?:improve|develop|fix it|디벨롭|디베롭|개선)[\s\S]{0,200}(?:simple|trivial|explore first)/i, 'metis <intent_classification> must call out vague Korean/English verbs and route them to simple/trivial or explore-first');
    assert.match(metis, /(?:explicit[\s\S]{0,20}(?:new feature|from scratch|greenfield)|name a new module|require[\s\S]{0,40}explicit)/i, 'metis <intent_classification> must require explicit greenfield keywords before classifying as build-from-scratch');
  });


  it('imports the OMO Prometheus judge-absorption pattern: gap triage, silent absorption, and single-decision test-strategy', () => {
    const metis = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md'));

    assert.match(metis, /<gap_triage>[\s\S]+<\/gap_triage>|gap[\s\S]{0,40}triage|CRITICAL[\s\S]{0,200}MINOR[\s\S]{0,200}AMBIGUOUS/i, 'metis must declare a gap-triage classification (CRITICAL / MINOR / AMBIGUOUS) for self_review');
    assert.match(metis, /CRITICAL[\s\S]{0,300}(?:emit|ask|user question|surfaces)/i, 'metis gap triage must route CRITICAL gaps to the user question slate');
    assert.match(metis, /MINOR[\s\S]{0,300}(?:self[-\s]?(?:fix|resolve|absorb)|stated assumption|safe assumption|continue)/i, 'metis gap triage must route MINOR gaps to a stated assumption and continue, NOT to a user question');
    assert.match(metis, /AMBIGUOUS[\s\S]{0,300}(?:default|safe default|industry default|conservative default)/i, 'metis gap triage must route AMBIGUOUS gaps to a default with explicit annotation');

    assert.match(metis, /<silent_absorption>[\s\S]+<\/silent_absorption>|silent[\s\S]{0,30}absorption|do not ask additional/i, 'metis must declare a silent-absorption rule: low-leverage gaps must be answered by Metis itself, not emitted as user questions');
    assert.match(metis, /(?:repo[\s\S]{0,30}context|prior turn|industry default|sensible default)[\s\S]{0,400}(?:assumption|continue|absorb)/i, 'metis silent_absorption must list the inference sources (repo context, prior turns, industry defaults) that replace user questions');

    assert.match(metis, /(?:single (?:bundled|combined|consolidated) test[\s-]?strategy|one test[\s-]?strategy decision|test[\s-]?infra[\s\S]{0,80}single decision)/i, 'metis intent_classification for build/refactor/test-infra must consolidate test strategy into a single bundled decision instead of three separate questions');
    assert.match(metis, /(?:TDD|test[\s-]?first)[\s\S]{0,300}(?:after[\s-]?implementation|post[\s-]?implementation|agent[\s-]?QA|none)/i, 'metis test-strategy decision must offer the canonical option set (TDD / test-after-implementation / agent-QA only / no automated tests)');
  });

  it('fan-out defaults to ON for non-trivial intents with per-intent mandatory minimums, matching OMO interview-mode-by-default', () => {
    const metis = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md'));

    assert.match(metis, /(?:default[\s-]?on|interview[\s-]?mode[\s-]?by[\s-]?default|Before (?:your |the )?first question|fan[\s-]?out is the default)/i, 'metis research_fan_out must declare default-on dispatch (OMO interview-mode-by-default), not trigger-conditional');
    assert.match(metis, /(?:per[\s-]?intent mandatory minimum|mandatory minimum dispatch|minimum per[\s-]?intent)/i, 'metis must declare per-intent mandatory minimum dispatch counts');
    assert.match(metis, /refactor[\s\S]{0,200}(?:1[\s\S]{0,10}explore|>=\s*1\s*explore|min(?:imum)?[\s\S]{0,20}1\s*explore)/i, 'metis must require minimum 1 explore for refactor intent (preservation surface map)');
    assert.match(metis, /build[\s-]?from[\s-]?scratch[\s\S]{0,240}1[\s\S]{0,10}explore[\s\S]{0,120}2[\s\S]{0,10}researcher/i, 'metis must require minimum 1 explore + 2 researcher for build-from-scratch');
    assert.match(metis, /architecture[\s\S]{0,240}1[\s\S]{0,10}explore[\s\S]{0,120}2[\s\S]{0,10}researcher/i, 'metis must require minimum 1 explore + 2 researcher for architecture');
    assert.match(metis, /test[\s-]?infra[\s\S]{0,240}1[\s\S]{0,10}explore[\s\S]{0,120}2[\s\S]{0,10}researcher/i, 'metis must require minimum 1 explore + 2 researcher for test-infra');
    assert.match(metis, /(?:skip[\s\S]{0,30}only when|skip[\s-]?out rule|skip rule)[\s\S]{0,300}trivial/i, 'metis must declare skip-out rules (trivial is the only universal skip)');
    assert.doesNotMatch(metis, /when triggers fire/i, 'metis must not preserve trigger-conditional fan-out wording; non-trivial planning dispatch is default-on');
    assert.doesNotMatch(metis, /simple` intent -> fan-out only when one specific signal is unfamiliar/i, 'simple intent must still run the baseline explore fan-out instead of skipping until unfamiliarity is detected');
    assert.match(metis, /simple` intent -> keep the mandatory baseline at exactly 1 `explore` agent/i, 'simple intent must keep one mandatory explore baseline before user questions');
    assert.match(readRepoFile(skillPath), /gpt-5\.4-mini[\s\S]{0,160}researcher[\s\S]{0,220}2 explore \+ 4 researcher/i, 'skill must expose exact mini researcher plus wider cheap fan-out');
  });

  it('detects user hostility or non-answer responses and exits the interview instead of incrementing the clearance count', () => {
    const metis = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md'));
    const skill = readRepoFile(skillPath);

    assert.match(metis, /<hostility_detection>[\s\S]+<\/hostility_detection>|hostil[\s\S]{0,40}detection|non[\s-]?answer[\s\S]{0,40}detection/i, 'metis must declare a hostility / non-answer detection block to exit the interview cleanly instead of consuming clearance budget');

    assert.match(metis, /(?:1[\s\-]?2 char|single character|one[\s-]?character|trivially short)[\s\S]{0,300}(?:answer|response|reply)/i, 'metis hostility detection must flag 1-2 character / trivially short responses as non-answers');
    assert.match(metis, /(?:알아서|figure it out|you decide|whatever)[\s\S]{0,200}(?:non[\s-]?answer|refusal|hostil|exit|escalate)/i, 'metis hostility detection must recognise dismissive "you decide / figure it out / 알아서" patterns as non-answers');
    assert.match(metis, /(?:profanit|시발|fuck|swear|insult|f-word)[\s\S]{0,200}(?:non[\s-]?answer|refusal|hostil|exit|escalate)/i, 'metis hostility detection must recognise profanity-laden responses as hostility signals');

    assert.match(metis, /(?:exit|terminate|abort|stop)[\s\S]{0,200}(?:interview|loop|round)/i, 'metis hostility detection must exit the interview loop, not continue asking');
    assert.match(metis, /(?:escalate|hand off|return control|surface the [hH]ostility)[\s\S]{0,300}(?:user|caller|Oracle|carry[-\s]?forward)/i, 'metis hostility detection must escalate the unresolved decision back to the user or carry it forward, not silently swallow it');
    assert.match(metis, /(?:do not increment|must not increment|does not count|invalidates? the (?:round|answer)|do NOT advance[\s\S]{0,80}checklist item)/i, 'metis hostile responses must not advance checklist YES');

    assert.match(skill, /(?:hostil|non[\s-]?answer|user (?:refus|reject|abort))[\s\S]{0,300}(?:exit|escalate|terminate|invalidate)/i, 'skill Rule-Based Clearance section must reflect the hostility exit path so the user sees the rule at the workflow level');
  });

  it('enforces the strengthened operator contract: iterative interview, rule-clearance, post-plan Metis, Momus bounded retry, and Oracle 2-pass', () => {
    const skill = readRepoFile(skillPath);
    const metis = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md'));
    const momus = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-momus.md'));
    const oracle = readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-oracle.md'));

    assert.match(
      skill,
      /pre-question research fan-out[\s\S]{0,300}non-trivial intent[\s\S]{0,300}`explore`[\s\S]{0,120}`researcher`/i,
      'skill must make active explore/researcher fan-out a planning-stage contract before user questions',
    );

    // Gate 1: Metis interview is iterative with multiple rounds capped at 5
    assert.match(
      skill,
      /Iterative|iterative loop|multiple interview rounds|interview rounds ARE expected/i,
      'skill Steps §2 must declare an iterative Metis interview',
    );
    assert.match(
      skill,
      /5 rounds|cap[\s\S]{0,40}5|round 5/i,
      'skill must cap Metis interview rounds at 5',
    );
    assert.match(
      metis,
      /multiple interview rounds|Run multiple interview rounds|next round/i,
      'metis prompt must declare multi-round operation',
    );
    assert.match(metis, /5 rounds|round[s]?[\s\S]{0,20}cap|cap[\s\S]{0,40}5/i, 'metis prompt must cap rounds at 5');

    // Gate 2: Rule-based clearance is deterministic, not subjective
    const clearanceRule = /6[- ]item checklist[\s\S]{0,800}objective[\s\S]{0,800}scope IN\+OUT[\s\S]{0,800}acceptance[\s\S]{0,800}test strategy[\s\S]{0,800}handoff target[\s\S]{0,800}no outstanding CRITICAL/i;
    assert.match(
      skill,
      clearanceRule,
      'skill must declare the 6-item checklist clearance gate',
    );
    assert.match(
      metis,
      clearanceRule,
      'metis prompt must declare the 6-item checklist gate',
    );

    // Gate 3: Post-plan Metis gap check before handoff
    assert.match(
      skill,
      /Post-Plan Gap Check|post-plan Metis gap check|Metis Re-Invocation|post-plan re-invocation/i,
      'skill must include a post-plan Metis gap check before handoff',
    );
    assert.match(
      metis,
      /post-plan re-invocation|Post-plan re-invocation|post-plan gap check|finalized plan|finalized Oracle plan/i,
      'metis prompt must document its post-plan re-invocation mode',
    );

    // Gate 4: Momus bounded retry after Oracle synthesis, capped at 3 cycles
    assert.match(
      skill,
      /Bounded Retry|bounded retry|Momus\s*→\s*Oracle re-synthesis|3 (times|cycles)/i,
      'skill Steps §3 must declare a bounded Momus retry contract',
    );
    assert.match(
      skill,
      /3 (times|cycles) total|up to[\s\S]{0,30}3 times|cycles at[\s\S]{0,10}3/i,
      'skill must cap Momus → Oracle re-synthesis at 3 cycles',
    );
    assert.match(
      momus,
      /bounded[-\s]?retry|re-invocation after Oracle synthesis|Oracle's resolutions did not introduce new risks/i,
      'momus prompt must declare the bounded-retry re-invocation contract',
    );
    assert.match(momus, /3 (times|cycles)|cycle 3/i, 'momus prompt must cap retry cycles at 3');

    // Gate 5: Oracle 2-pass (synthesis + self-verification) with 3-cycle cap
    assert.match(
      skill,
      /Two-?Pass|Pass 1[\s\S]{0,30}Synthesis[\s\S]{0,500}Pass 2/i,
      'skill Steps §4 must declare an Oracle 2-pass (synthesis + self-verification) loop',
    );
    assert.match(
      skill,
      /Self-?Verification|self-verification|machine-checkable acceptance contract/i,
      'skill must name Oracle Pass 2 as machine-checkable self-verification',
    );
    assert.match(
      skill,
      /Pass 1[\s\S]{0,20}↔[\s\S]{0,20}Pass 2[\s\S]{0,80}3|cycles? at[\s\S]{0,10}3/i,
      'skill must cap Pass 1 ↔ Pass 2 cycles at 3',
    );
    assert.match(
      oracle,
      /Pass 1[\s\S]{0,30}Synthesis[\s\S]{0,800}Pass 2[\s\S]{0,80}Self-?Verification/i,
      'oracle prompt must split execution into Pass 1 (Synthesis) and Pass 2 (Self-Verification)',
    );
    assert.match(
      oracle,
      /machine-checkable acceptance contract/i,
      'oracle prompt must label Pass 2 as the machine-checkable acceptance contract',
    );
    assert.match(
      oracle,
      /verification matrix has an explicit evidence source/i,
      'oracle Pass 2 must require explicit evidence sources for every verification-matrix claim',
    );
    assert.match(
      oracle,
      /shared-file conflicts between parallel lanes/i,
      'oracle Pass 2 must guard against shared-file conflicts between parallel lanes',
    );
    assert.match(
      oracle,
      /mutually consistent|acceptance criterion is satisfied by a state that also triggers rollback/i,
      'oracle Pass 2 must require stop/rollback/acceptance mutual consistency',
    );
    assert.match(oracle, /cap[\s\S]{0,40}3|cycles? at[\s\S]{0,10}3/i, 'oracle prompt must cap Pass 1 ↔ Pass 2 cycles at 3');

    // Gate 6: Final_Checklist reflects the strengthened gates
    assert.match(skill, /checklist clearance/i, 'Final_Checklist must reference checklist clearance');
    assert.match(skill, /Oracle Pass 2 self-verification/i, 'Final_Checklist must reference Oracle Pass 2 self-verification');
    assert.match(skill, /Post-plan Metis gap check/i, 'Final_Checklist must reference the post-plan Metis gap check');
  });

  it('wires catalog, agent definitions, and explicit keyword activation', () => {
    assert.ok(existsSync(skillPath), 'prometheus-strict skill must exist');

    const manifest = JSON.parse(readRepoFile(join(repoRoot, 'src', 'catalog', 'manifest.json'))) as {
      skills: Array<{ name: string; category?: string; status?: string }>;
      agents: Array<{ name: string; category?: string; status?: string }>;
    };

    assert.ok(
      manifest.skills.some((skill) => skill.name === 'prometheus-strict' && skill.status === 'active' && skill.category === 'planning'),
      'catalog manifest must expose prometheus-strict as an active planning skill',
    );

    for (const promptName of promptNames) {
      assert.ok(
        manifest.agents.some((agent) => agent.name === promptName && agent.status === 'active'),
        `catalog manifest must expose ${promptName}`,
      );
      assert.ok(AGENT_DEFINITIONS[promptName], `agent definition must include ${promptName}`);
      assert.equal(AGENT_DEFINITIONS[promptName]?.tools, 'analysis', `${promptName} should stay in planning/analysis mode`);
    }

    const prometheusTriggers = KEYWORD_TRIGGER_DEFINITIONS.filter((entry) => entry.skill === 'prometheus-strict');
    assert.deepEqual(
      prometheusTriggers.map((entry) => entry.keyword),
      ['$prometheus-strict'],
      'prometheus-strict should be explicit-only to avoid accidental concept-word routing',
    );
  });
});
