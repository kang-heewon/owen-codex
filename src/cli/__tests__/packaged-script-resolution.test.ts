import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('packaged script resolution contract', () => {
  it('resolves the retained outbound notify hook from dist/scripts', () => {
    const setupSource = readFileSync(join(process.cwd(), 'src', 'cli', 'setup.ts'), 'utf-8');
    const generatorSource = readFileSync(join(process.cwd(), 'src', 'config', 'generator.ts'), 'utf-8');
    for (const source of [setupSource, generatorSource]) {
      assert.match(source, /join\(pkgRoot,\s*["']dist["'],\s*["']scripts["'],\s*["']notify-hook\.js["']\)/);
      assert.doesNotMatch(source, /hook-derived-watcher\.js/);
    }
  });
});
