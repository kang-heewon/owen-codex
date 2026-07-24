import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const skillsRoot = join(repoRoot, 'skills');

function skillContent(name: string): string {
  return readFileSync(join(skillsRoot, name, 'SKILL.md'), 'utf8');
}

function skillNames(): string[] {
  return readdirSync(skillsRoot)
    .filter((name) => statSync(join(skillsRoot, name)).isDirectory())
    .sort();
}

describe('skill catalog hygiene', () => {
  it('keeps the cleanup subset free of obsolete prompt/tool boilerplate', () => {
    const cleanupSubset = ['analyze', 'deep-interview', 'ecomode', 'git-master', 'plan', 'tdd', 'ultraqa', 'ultrawork', 'web-clone'];
    const obsolete = [
      /ToolSearch\(/,
      /mcp__[^\s`]+/,
      /GPT-5\.4 Guidance Alignment/,
      /Task:\s*\{\{ARGUMENTS\}\}/,
      /delegate\(role=/,
    ];

    const offenders = cleanupSubset.flatMap((name) => {
      const content = skillContent(name);
      return obsolete
        .filter((pattern) => pattern.test(content))
        .map((pattern) => `${name}: ${pattern}`);
    });

    assert.deepEqual(offenders, []);
  });

  it('keeps primary workflow guidance CLI-first instead of MCP-first', () => {
    const primaryWorkflows = [
      'autopilot',
      'code-review',
      'ecomode',
      'plan',
      'ralph',
      'tdd',
      'ultraqa',
      'ultrawork',
      'wiki',
    ];
    const mcpFirstPatterns = [
      /Use `owx_state` MCP tools/i,
      /Use the `owx_state` MCP server tools/i,
      /Before first MCP tool use, call `ToolSearch\("mcp"\)`/i,
      /If ToolSearch finds no MCP tools/i,
      /state_write MCP tool/i,
      /write subsequent updates via owx_state MCP/i,
      /owx state clear --mode/i,
      /owx state state_write/i,
      /state_(?:read|write)\(mode=/i,
      /wiki_(?:ingest|query|lint|add|list|read|delete|refresh)\([^)]*\)/,
    ];

    const offenders = primaryWorkflows.flatMap((name) => {
      const content = skillContent(name);
      return mcpFirstPatterns
        .filter((pattern) => pattern.test(content))
        .map((pattern) => `${name}: ${pattern}`);
    });

    assert.deepEqual(offenders, []);
  });
});
