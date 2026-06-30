import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_HELP_COMMANDS = [
  'owx',
  'owx adapt',
  'owx agents',
  'owx agents-init',
  'owx api',
  'owx ask',
  'owx auth',
  'owx autoresearch',
  'owx autoresearch-goal',
  'owx cancel',
  'owx cleanup',
  'owx code-intel',
  'owx deepinit',
  'owx doctor',
  'owx exec',
  'owx explore',
  'owx help',
  'owx hooks',
  'owx hud',
  'owx imagegen',
  'owx list',
  'owx mcp-serve',
  'owx notepad',
  'owx performance-goal',
  'owx project-memory',
  'owx question',
  'owx ralph',
  'owx reasoning',
  'owx resume',
  'owx session',
  'owx setup',
  'owx sidecar',
  'owx sparkshell',
  'owx state',
  'owx status',
  'owx surface',
  'owx team',
  'owx tmux-hook',
  'owx trace',
  'owx ultragoal',
  'owx uninstall',
  'owx update',
  'owx version',
  'owx wiki',
];

function runOwx(cwd: string, argv: string[]) {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(testDir, '..', '..', '..');
  const owxBin = join(repoRoot, 'dist', 'cli', 'owx.js');
  return spawnSync(process.execPath, [owxBin, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      OWX_AUTO_UPDATE: '0',
      OWX_NOTIFY_FALLBACK: '0',
      OWX_HOOK_DERIVED_SIGNALS: '0',
    },
  });
}

describe('cli/surface', () => {
  it('runs surface check as JSON', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-surface-cli-'));
    try {
      const result = runOwx(cwd, ['surface', 'check', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout) as {
        status?: string;
        checks?: Array<{ name?: string; status?: string }>;
        helpCommands?: string[];
        registeredCommands?: string[];
        registry?: { schemaVersion?: number };
      };
      assert.equal(payload.status, 'passed');
      assert.ok(payload.checks?.some((check) => check.name === 'default-help-command-registry' && check.status === 'passed'));
      assert.equal(payload.registry?.schemaVersion, 1);
      assert.deepEqual(payload.helpCommands, DEFAULT_HELP_COMMANDS);
      assert.ok(payload.registeredCommands?.includes('owx surface'));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
