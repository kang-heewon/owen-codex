import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AGENT_DEFINITIONS } from '../../agents/definitions.js';
import { generateAgentToml } from '../../agents/native-config.js';
import {
  renderAgentsModelTableBlock,
  resolveAgentsModelTableContext,
} from '../../utils/agents-model-table.js';
import { checkNativeAgentModelRouting, checkSparkRouting } from '../doctor.js';

function makePaths(codexHomeDir: string) {
  return {
    codexHomeDir,
    configPath: join(codexHomeDir, 'config.toml'),
    hooksPath: join(codexHomeDir, 'hooks.json'),
    promptsDir: join(codexHomeDir, 'prompts'),
    skillsDir: join(codexHomeDir, 'skills'),
    agentsDir: join(codexHomeDir, 'agents'),
    stateDir: join(codexHomeDir, 'state'),
  };
}

describe('checkNativeAgentModelRouting', () => {
  let root: string;
  let paths: ReturnType<typeof makePaths>;
  const savedFrontier = process.env.OWX_DEFAULT_FRONTIER_MODEL;
  const savedStandard = process.env.OWX_DEFAULT_STANDARD_MODEL;

  beforeEach(() => {
    delete process.env.OWX_DEFAULT_FRONTIER_MODEL;
    delete process.env.OWX_DEFAULT_STANDARD_MODEL;
    root = mkdtempSync(join(tmpdir(), 'owx-doctor-agent-models-'));
    paths = makePaths(root);
    mkdirSync(paths.agentsDir, { recursive: true });
    writeFileSync(paths.configPath, 'model = "gpt-6-astra"\nmodel_reasoning_effort = "xhigh"\n');
  });

  afterEach(() => {
    if (savedFrontier === undefined) delete process.env.OWX_DEFAULT_FRONTIER_MODEL;
    else process.env.OWX_DEFAULT_FRONTIER_MODEL = savedFrontier;
    if (savedStandard === undefined) delete process.env.OWX_DEFAULT_STANDARD_MODEL;
    else process.env.OWX_DEFAULT_STANDARD_MODEL = savedStandard;
    rmSync(root, { recursive: true, force: true });
  });

  it('warns for stale installed managed roles across frontier and standard lanes', () => {
    for (const role of ['architect', 'executor']) {
      writeFileSync(
        join(paths.agentsDir, `${role}.toml`),
        `# owen-codex agent: ${role}\nname = "${role}"\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "${AGENT_DEFINITIONS[role].reasoningEffort}"\n`,
      );
    }

    const result = checkNativeAgentModelRouting(paths, 'user', root, {
      installableAgentNames: ['architect', 'executor'],
      agentsMdPath: join(root, 'missing-AGENTS.md'),
    });

    assert.equal(result.status, 'warn');
    assert.match(result.message, /architect\.toml model is `gpt-5\.6-sol`; expected `gpt-6-astra`/);
    assert.match(result.message, /executor\.toml model is `gpt-5\.6-sol`; expected `gpt-6-astra`/);
  });

  it('accepts canonical generated roles, including exact pins, and preserves user-owned TOML', () => {
    writeFileSync(
      join(paths.agentsDir, 'architect.toml'),
      generateAgentToml(AGENT_DEFINITIONS.architect, 'prompt', {
        codexHomeOverride: root,
        configTomlContent: readFileSync(paths.configPath, 'utf8'),
        env: process.env,
      }),
    );
    writeFileSync(
      join(paths.agentsDir, 'git-master.toml'),
      generateAgentToml(AGENT_DEFINITIONS['git-master'], 'prompt', {
        codexHomeOverride: root,
        configTomlContent: readFileSync(paths.configPath, 'utf8'),
        env: process.env,
      }),
    );
    writeFileSync(join(paths.agentsDir, 'executor.toml'), 'name = "executor"\nmodel = "custom"\n');

    const result = checkNativeAgentModelRouting(paths, 'user', root, {
      installableAgentNames: ['architect', 'git-master', 'executor'],
      agentsMdPath: join(root, 'missing-AGENTS.md'),
    });

    assert.equal(result.status, 'pass');
    assert.match(result.message, /2 OWX-managed native role/);
    assert.match(result.message, /executor\.toml \(user-managed\)/);
  });

  it('warns when the managed AGENTS model table drifts while ignoring surrounding user content', () => {
    const agentsMdPath = join(root, 'AGENTS.md');
    const current = renderAgentsModelTableBlock(
      resolveAgentsModelTableContext(readFileSync(paths.configPath, 'utf8'), {
        codexHomeOverride: root,
        env: process.env,
      }),
    );
    writeFileSync(agentsMdPath, `user notes\n${current.replaceAll('gpt-6-astra', 'gpt-5.6-sol')}\nmore user notes\n`);

    const result = checkNativeAgentModelRouting(paths, 'user', root, {
      installableAgentNames: [],
      agentsMdPath,
    });

    assert.equal(result.status, 'warn');
    assert.match(result.message, /managed model table.*is stale/);
  });

  it('warns for missing installed roles and a missing model block in generated guidance', () => {
    const agentsMdPath = join(root, 'AGENTS.md');
    writeFileSync(agentsMdPath, '<!-- owx:generated:agents-md -->\n# OWX instructions\n');
    const result = checkNativeAgentModelRouting(paths, 'user', root, {
      installableAgentNames: ['executor'],
      agentsMdPath,
    });
    assert.equal(result.status, 'warn');
    assert.match(result.message, /missing native roles: executor\.toml/);
    assert.match(result.message, /managed model table.*is missing/);
  });

  it('accepts an explicit Spark effort consistently across both diagnostics', () => {
    writeFileSync(join(root, '.owx-config.json'), JSON.stringify({ agentReasoning: { explore: 'high' } }));
    writeFileSync(join(paths.agentsDir, 'explore.toml'), generateAgentToml(AGENT_DEFINITIONS.explore, 'prompt', { codexHomeOverride: root }));
    assert.equal(checkSparkRouting(paths).status, 'pass');
    assert.equal(checkNativeAgentModelRouting(paths, 'user', root, { installableAgentNames: ['explore'] }).status, 'pass');
  });

  it('rejects effort above the supported range of exact mini model pins', () => {
    for (const effort of ['max', 'ultra']) {
      writeFileSync(join(root, '.owx-config.json'), JSON.stringify({ agentReasoning: { 'git-master': effort } }));
      assert.throws(
        () => generateAgentToml(AGENT_DEFINITIONS['git-master'], 'prompt', { codexHomeOverride: root }),
        /gpt-5\.4-mini does not support reasoning effort/,
      );
    }
  });

  it('rejects unsupported effort for known OpenAI models and leaves custom providers to the host', () => {
    for (const [model, role, effort] of [
      ['gpt-5.6-luna', 'explore', 'ultra'],
      ['gpt-5.5', 'executor', 'max'],
      ['gpt-5.3-codex-spark', 'executor', 'max'],
    ]) {
      writeFileSync(join(root, '.owx-config.json'), JSON.stringify({ agentReasoning: { [role]: effort } }));
      writeFileSync(paths.configPath, `model = "${model}"\n`);
      assert.throws(
        () => generateAgentToml(AGENT_DEFINITIONS[role], 'prompt', { codexHomeOverride: root }),
        /does not support reasoning effort/,
      );
      writeFileSync(paths.configPath, `model = "${model}"\nmodel_provider = "custom"\n`);
      assert.doesNotThrow(() => generateAgentToml(AGENT_DEFINITIONS[role], 'prompt', { codexHomeOverride: root }));
    }
  });
});
