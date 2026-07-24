import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('foreground isolation contract for hook background helpers', () => {
  it('keeps hook plugin runner subprocesses hidden while capturing output', async () => {
    const source = await readFile(join(process.cwd(), 'dist', 'hooks', 'extensibility', 'dispatcher.js'), 'utf-8');
    assert.match(source, /stdio:\s*\[\s*['"]pipe['"],\s*['"]pipe['"],\s*['"]pipe['"]\s*\]/);
    assert.match(source, /windowsHide:\s*true/);
  });
});
