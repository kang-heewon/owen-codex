import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { auditFiles, auditText, parseChangedLinesFromDiff } from '../fallback-audit.js';

describe('fallback-audit', () => {
  it('flags empty catch blocks', () => {
    const findings = auditText('src/example.ts', `
      try {
        risky();
      } catch {
      }
    `);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'empty-catch');
  });

  it('flags silent default returns from catch blocks', () => {
    const findings = auditText('src/example.ts', `
      function load() {
        try {
          return read();
        } catch (error) {
          return [];
        }
      }
    `);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'catch-default-return');
  });

  it('allows explicit failure behavior', () => {
    const findings = auditText('src/example.ts', `
      function load() {
        try {
          return read();
        } catch (error) {
          throw new Error('load_failed', { cause: error });
        }
      }
    `);

    assert.deepEqual(findings, []);
  });

  it('parses changed line ranges from zero-context git diffs', () => {
    const changedLines = parseChangedLinesFromDiff(`diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -3,0 +4,2 @@
+      } catch {
+        return [];
@@ -12 +15 @@
-old();
+new();
`);

    assert.deepEqual(Array.from(changedLines.get('src/example.ts') ?? []), [4, 5, 15]);
  });

  it('ignores existing file findings when the diff has no changed target lines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fallback-audit-'));
    try {
      await writeFile(
        join(root, 'example.ts'),
        `
          try {
            risky();
          } catch {
            return null;
          }
        `,
      );

      const findings = auditFiles(root, ['example.ts'], {
        changedLinesByPath: new Map(),
      });

      assert.deepEqual(findings, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
