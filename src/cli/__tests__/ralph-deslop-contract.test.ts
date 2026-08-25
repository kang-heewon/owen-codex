import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ralphSkill = readFileSync(join(__dirname, '../../../skills/ralph/SKILL.md'), 'utf-8');

describe('ralph deslop workflow contract', () => {
  it('orders cleanup and post-clean verification before final architect review', () => {
    assert.match(ralphSkill, /Step 7\.5/i);
    assert.match(ralphSkill, /Mandatory Deslop Pass/i);
    assert.match(ralphSkill, /owen-codex:ai-slop-cleaner/i);
    assert.match(ralphSkill, /changed files only/i);
    assert.match(ralphSkill, /automatic finalization profile/i);

    const verification = ralphSkill.indexOf('6. **Verify the stable final candidate with fresh evidence**');
    const cleaner = ralphSkill.indexOf('7.5 **Mandatory Deslop Pass**');
    const reverification = ralphSkill.indexOf('7.6 **Regression Re-verification**');
    const architect = ralphSkill.indexOf('8. **Final architect verification of the exact cleaned diff**');
    const audit = ralphSkill.indexOf('9. **Completion audit**');

    assert.ok(verification >= 0);
    assert.ok(verification < cleaner);
    assert.ok(cleaner < reverification);
    assert.ok(reverification < architect);
    assert.ok(architect < audit);
  });

  it('requires post-deslop regression re-verification', () => {
    assert.match(ralphSkill, /Step 7\.6/i);
    assert.match(ralphSkill, /Regression Re-verification/i);
    assert.match(ralphSkill, /re-run all tests\/build\/lint/i);
    assert.match(ralphSkill, /roll back cleaner changes or fix and retry/i);
    assert.match(ralphSkill, /Do not blindly rerun the cleaner in a loop/i);
  });

  it('extends the final checklist with deslop completion and post-deslop regression proof', () => {
    assert.match(
      ralphSkill,
      /\[ \] ai-slop-cleaner pass completed on changed files \(or --no-deslop specified\)/i,
    );
    assert.match(ralphSkill, /\[ \] Post-deslop regression tests pass/i);
    assert.match(ralphSkill, /Architect verification of the exact post-clean diff/i);
    assert.match(ralphSkill, /No source change occurred after architect approval/i);
  });
});
