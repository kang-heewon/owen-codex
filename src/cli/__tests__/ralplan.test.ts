import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const cliPath = join(process.cwd(), 'dist', 'cli', 'owx.js');

describe('removed ralplan role-intent CLI', () => {
  it('rejects the removed role-intent producer surface', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-removed-'));
    try {
      const result = spawnSync(process.execPath, [
        cliPath,
        'ralplan',
        'role-intent',
        'write',
        '--role',
        'architect',
        '--parent-thread',
        'leader',
        '--json',
      ], { cwd, encoding: 'utf-8' });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Unknown command: ralplan/);
      assert.doesNotMatch(result.stdout, /role-intent|ralplan\s+Record validated/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('does not advertise ralplan as a public CLI command', () => {
    const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf-8' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /owx ralplan/);
    assert.doesNotMatch(result.stdout, /role-intent/);
  });
});
