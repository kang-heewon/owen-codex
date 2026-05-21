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

  it('keeps the skill planning-only, OMX-native, and clean-room credited', () => {
    assert.ok(existsSync(skillPath), 'prometheus-strict skill must exist');
    assert.ok(existsSync(readmePath), 'prometheus-strict README must exist');

    const skill = readRepoFile(skillPath);
    const readme = readRepoFile(readmePath);

    for (const [label, content] of [
      ['skill', skill],
      ['readme', readme],
    ] as const) {
      assert.match(content, /clean-room/i, `${label} must state the clean-room boundary`);
      assert.match(
        content,
        /OMO Prometheus[\s\S]*`code-yeongyu\/oh-my-openagent`[\s\S]*reimplemented from concept under MIT/i,
        `${label} must preserve concept-only credit`,
      );
      assert.match(content, /Metis/i, `${label} must include the Metis interview role`);
      assert.match(content, /Momus/i, `${label} must include the Momus critique role`);
      assert.match(content, /Oracle/i, `${label} must include the Oracle synthesis role`);
      assert.match(content, /\$ultragoal/i, `${label} must hand off through OMX ultragoal`);
      assert.match(content, /\$team/i, `${label} must mention team only as a warranted handoff`);
      assert.match(content, /No hook implementation/i, `${label} must keep hook work out of scope`);
      assert.match(content, /No Sisyphus|No Sisyphus\/start-work port/i, `${label} must reject Sisyphus ports`);
      assert.match(content, /start-work/i, `${label} must explicitly reject start-work ports`);
      assert.match(content, /planning-only|Planning and interview only|planning skill/i, `${label} must stay planning-only`);
      assert.match(content, /\.omx\/plans\/prometheus-strict\//i, `${label} must document the durable prometheus-strict plan path`);
      assert.doesNotMatch(content, /@opencode-ai\/plugin|bun:sqlite|\.sisyphus/i, `${label} must not leak OMO runtime details`);
    }

    for (const section of [
      'Purpose',
      'Use_When',
      'Do_Not_Use_When',
      'Why_This_Exists',
      'Execution_Policy',
      'Steps',
      'Tool_Usage',
      'Final_Checklist',
      'Advanced',
    ]) {
      assert.match(skill, new RegExp(`<${section}>`), `skill must include <${section}>`);
      assert.match(skill, new RegExp(`</${section}>`), `skill must close </${section}>`);
    }

    assert.match(skill, /## State Management/, 'skill must include state management section');
    assert.match(skill, /Original task:\n\{\{PROMPT\}\}\s*$/, 'skill must end with the canonical prompt footer');
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
      assert.match(content, new RegExp(`OMX:GUIDANCE:${role}:CONSTRAINTS:START`), `${promptName} must include constraints guidance start marker`);
      assert.match(content, new RegExp(`OMX:GUIDANCE:${role}:CONSTRAINTS:END`), `${promptName} must include constraints guidance end marker`);
      assert.match(content, new RegExp(`OMX:GUIDANCE:${role}:OUTPUT:START`), `${promptName} must include output guidance start marker`);
      assert.match(content, new RegExp(`OMX:GUIDANCE:${role}:OUTPUT:END`), `${promptName} must include output guidance end marker`);
    }

    assert.match(readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-metis.md')), /Metis Clarification/i);
    assert.match(readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-momus.md')), /Momus Critique/i);
    assert.match(readRepoFile(join(repoRoot, 'prompts', 'prometheus-strict-oracle.md')), /Prometheus Strict Plan/i);
  });

  it('routes interview questions through the OMX structured question surface with documented fallbacks', () => {
    const skill = readRepoFile(skillPath);

    assert.match(skill, /omx question/, 'skill must name `omx question` as the structured question surface');
    assert.match(
      skill,
      /native structured input/i,
      'skill must document the outside-tmux native structured input fallback',
    );
    assert.match(
      skill,
      /plain[-\s]?text/i,
      'skill must document the plain-text last-resort fallback',
    );
    assert.match(
      skill,
      /attached[-\s]?tmux/i,
      'skill must name the attached-tmux precondition for `omx question`',
    );

    for (const promptName of promptNames) {
      const promptPath = join(repoRoot, 'prompts', `${promptName}.md`);
      const content = readRepoFile(promptPath);
      assert.match(
        content,
        /omx question/,
        `${promptName} must reference the OMX structured question surface (omx question)`,
      );
      assert.match(
        content,
        /native structured input|plain[-\s]?text/i,
        `${promptName} must reference at least one documented question fallback`,
      );
    }
  });

  it('pins the public docs entry for the skill handoff path', () => {
    assert.ok(existsSync(skillPath), 'prometheus-strict skill must exist');

    const docs = readRepoFile(join(repoRoot, 'docs', 'skills.html'));
    assert.match(docs, /\$prometheus-strict/i, 'docs must advertise the explicit prometheus-strict skill token');
    assert.match(docs, /Metis/i, 'docs must mention the Metis role');
    assert.match(docs, /Momus/i, 'docs must mention the Momus role');
    assert.match(docs, /Oracle/i, 'docs must mention the Oracle role');
    assert.match(docs, /\$ultragoal/i, 'docs must preserve the OMX-native ultragoal handoff');
    assert.match(docs, /\.omx\/plans\/prometheus-strict\//i, 'docs must preserve the durable plan artifact path');
    assert.match(
      docs,
      /Inspired by OMO Prometheus[\s\S]*code-yeongyu\/oh-my-openagent[\s\S]*reimplemented from concept under MIT/i,
      'docs must preserve clean-room concept credit',
    );
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
