import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(testDir, '..', '..', '..', 'dist', 'scripts');

async function loadModule(relativePath: string) {
  return import(pathToFileURL(join(scriptsDir, relativePath)).href);
}

describe('retained notify-hook modules', () => {
  it('normalizes primitive payload values', async () => {
    const { asNumber, safeString } = await loadModule('notify-hook/utils.js');
    assert.equal(asNumber('7'), 7);
    assert.equal(asNumber('not-a-number'), null);
    assert.equal(safeString(null, 'fallback'), 'fallback');
  });

  it('classifies concrete operational commands without matching searches', async () => {
    const { classifyExecCommand } = await loadModule('notify-hook/operational-events.js');
    assert.deepEqual(classifyExecCommand('npm test'), { kind: 'test', command: 'npm test' });
    assert.equal(classifyExecCommand('rg "npm test" src'), null);
  });

  it('prunes recent turn history deterministically', async () => {
    const { pruneRecentTurns } = await loadModule('notify-hook/state-io.js');
    const now = Date.now();
    assert.deepEqual(pruneRecentTurns({ fresh: now - 1_000, stale: now - 90_000_000 }, now), {
      fresh: now - 1_000,
    });
  });
});
