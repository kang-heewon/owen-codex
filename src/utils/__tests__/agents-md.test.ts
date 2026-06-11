import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addGeneratedAgentsMarker,
  hasOmxAgentsContract,
  hasOmxManagedAgentsSections,
  isOmxGeneratedAgentsMd,
  OWX_GENERATED_AGENTS_MARKER,
  OWX_MANAGED_AGENTS_END_MARKER,
  OWX_MANAGED_AGENTS_START_MARKER,
} from '../agents-md.js';

describe('agents-md helpers', () => {
  it('inserts the generated marker after the autonomy directive block', () => {
    const content = [
      '<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->',
      'YOU ARE AN AUTONOMOUS CODING AGENT. EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION.',
      'DO NOT STOP TO ASK "SHOULD I PROCEED?" — PROCEED. DO NOT WAIT FOR CONFIRMATION ON OBVIOUS NEXT STEPS.',
      'IF BLOCKED, TRY AN ALTERNATIVE APPROACH. ONLY ASK WHEN TRULY AMBIGUOUS OR DESTRUCTIVE.',
      '<!-- END AUTONOMY DIRECTIVE -->',
      '# owen-codex - Intelligent Multi-Agent Orchestration',
    ].join('\n');

    const result = addGeneratedAgentsMarker(content);

    assert.match(
      result,
      /<!-- END AUTONOMY DIRECTIVE -->\n<!-- owx:generated:agents-md -->\n# owen-codex - Intelligent Multi-Agent Orchestration/,
    );
  });

  it('does not duplicate an existing generated marker', () => {
    const content = `header\n${OWX_GENERATED_AGENTS_MARKER}\nbody\n`;
    assert.equal(addGeneratedAgentsMarker(content), content);
  });

  it('does not treat a standalone generated marker as the full OWX contract', () => {
    const content = `header\n${OWX_GENERATED_AGENTS_MARKER}\nbody\n`;

    assert.equal(isOmxGeneratedAgentsMd(content), true);
    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('treats autonomy-directive generated files as OWX-managed once marked', () => {
    const content = [
      '<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->',
      'directive body',
      '<!-- END AUTONOMY DIRECTIVE -->',
      OWX_GENERATED_AGENTS_MARKER,
      '# owen-codex - Intelligent Multi-Agent Orchestration',
      'AGENTS.md is the top-level operating contract for the workspace.',
    ].join('\n');

    assert.equal(isOmxGeneratedAgentsMd(content), true);
    assert.equal(hasOmxAgentsContract(content), true);
  });

  it('does not treat title-only user AGENTS.md content as OWX-generated', () => {
    const content = [
      '# owen-codex - Intelligent Multi-Agent Orchestration',
      '',
      'User-authored guidance without any OWX ownership markers.',
    ].join('\n');

    assert.equal(isOmxGeneratedAgentsMd(content), false);
    assert.equal(hasOmxManagedAgentsSections(content), false);
    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('recognizes explicit OWX-owned model table blocks as managed sections', () => {
    const content = [
      '# Shared ownership AGENTS',
      '',
      '<!-- OWX:MODELS:START -->',
      'managed table',
      '<!-- OWX:MODELS:END -->',
    ].join('\n');

    assert.equal(isOmxGeneratedAgentsMd(content), false);
    assert.equal(hasOmxManagedAgentsSections(content), true);
    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('recognizes merged AGENTS blocks as carrying the OWX contract only when the generated marker is inside', () => {
    const content = [
      '# Shared ownership AGENTS',
      '',
      OWX_MANAGED_AGENTS_START_MARKER,
      '<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->',
      '<!-- END AUTONOMY DIRECTIVE -->',
      OWX_GENERATED_AGENTS_MARKER,
      '# owen-codex - Intelligent Multi-Agent Orchestration',
      'AGENTS.md is the top-level operating contract for the workspace.',
      OWX_MANAGED_AGENTS_END_MARKER,
    ].join('\n');

    assert.equal(isOmxGeneratedAgentsMd(content), true);
    assert.equal(hasOmxManagedAgentsSections(content), true);
    assert.equal(hasOmxAgentsContract(content), true);
  });

  it('does not accept a generated marker plus heading without the semantic contract text', () => {
    const content = [
      OWX_GENERATED_AGENTS_MARKER,
      '# owen-codex - Intelligent Multi-Agent Orchestration',
      'User-authored text that happens to reuse the title.',
    ].join('\n');

    assert.equal(hasOmxAgentsContract(content), false);
  });

  it('does not accept a managed AGENTS block that lacks the generated contract marker', () => {
    const content = [
      '# Shared ownership AGENTS',
      '',
      OWX_MANAGED_AGENTS_START_MARKER,
      '# owen-codex - Intelligent Multi-Agent Orchestration',
      'AGENTS.md is the top-level operating contract for the workspace.',
      OWX_MANAGED_AGENTS_END_MARKER,
    ].join('\n');

    assert.equal(hasOmxAgentsContract(content), false);
  });
});
