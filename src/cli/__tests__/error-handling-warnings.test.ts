import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('error-handling warning guards', () => {
  it('hides Windows child windows for update and notification helpers', async () => {
    const updateSource = await readSource('src/cli/update.ts');
    const notifierSource = await readSource('src/notifications/notifier.ts');

    assert.match(updateSource, /windowsHide: true/);
    assert.match(notifierSource, /execFileAsync\(cmd, args, \{ windowsHide: true \}\)/);
  });

  it('replaces silent log-write catches with warning logs', async () => {
    const loggingSource = await readSource('src/hooks/extensibility/logging.ts');
    const dispatchSource = await readSource('src/hooks/extensibility/dispatcher.ts');
    const keywordSource = await readSource('src/hooks/keyword-detector.ts');

    assert.ok(!loggingSource.includes('.catch(() => {});'));
    assert.ok(!dispatchSource.includes('.catch(() => {});'));
    assert.ok(!keywordSource.includes('.catch(() => {});'));

    assert.match(loggingSource, /failed to append hook plugin log entry/);
    assert.match(dispatchSource, /failed to append hook dispatch log entry/);
    assert.match(keywordSource, /failed to persist keyword activation state/);
  });
});
