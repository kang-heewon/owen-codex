import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('native hook dispatch contract', () => {
  it('dispatches native hook events through the retained extensibility runtime', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'scripts', 'codex-native-hook.ts'), 'utf-8');
    assert.match(
      source,
      /buildNativeHookEvent\(owxEventName,[\s\S]*?await dispatchHookEventRuntime\(\{ event, cwd \}\);/,
    );
  });
});
