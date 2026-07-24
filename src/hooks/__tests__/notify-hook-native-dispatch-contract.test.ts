import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('notify-hook native dispatch contract', () => {
  it('dispatches notify-hook native and derived events fail-soft', async () => {
    const source = await readFile(join(process.cwd(), 'dist', 'scripts', 'notify-hook.js'), 'utf-8');
    assert.match(source, /await dispatchHookEvent\(event, \{ cwd \}\)\.catch/);
    assert.match(source, /await dispatchHookEvent\(derived, \{ cwd \}\)\.catch/);
    const matches = source.match(/await dispatchHookEvent\(event, \{ cwd \}\)\.catch/g) ?? [];
    assert.equal(matches.length, 1, `expected one native turn-complete dispatch, found ${matches.length}`);
  });
});
