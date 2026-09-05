import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { executeStateOperation } from '../operations.js';

it('documented cancellation preserves Ralph evidence and unrelated sessions', async () => {
  const skill = await readFile('skills/cancel/SKILL.md', 'utf8');
  const script = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((match) => match[1]).find((block) => block.includes('CANCEL_INPUT='));
  assert.ok(script, 'default cancellation must use a terminal write');
  const dir = await mkdtemp(join(tmpdir(), 'owx-cancel-example-'));
  try {
    for (const session of ['owned', 'unrelated']) {
      const stateDir = join(dir, '.owx/state/sessions', session);
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'ralph-state.json'), JSON.stringify({
        active: true, current_phase: 'executing', task_description: 'keep progress',
      }));
      await writeFile(join(stateDir, 'ralph-verification.json'), '{"evidence":"keep"}');
    }
    // Capture the documented CLI payload, then execute it against the real state API.
    const result = spawnSync('bash', ['-c', 'owx() { printf "%s" "$4"; }\n' + script], {
      env: { ...process.env, MODE: 'ralph', SESSION_ID: 'owned', WORKING_DIRECTORY: dir },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const response = await executeStateOperation('state_write', JSON.parse(result.stdout));
    assert.equal(response.isError, undefined, JSON.stringify(response.payload));
    const ownedDir = join(dir, '.owx/state/sessions/owned');
    const state = JSON.parse(await readFile(join(ownedDir, 'ralph-state.json'), 'utf8'));
    assert.equal(state.active, false);
    assert.equal(state.current_phase, 'cancelled');
    assert.equal(state.run_outcome, 'cancelled');
    assert.ok(Date.parse(state.completed_at));
    assert.equal(state.task_description, 'keep progress');
    assert.equal(await readFile(join(ownedDir, 'ralph-verification.json'), 'utf8'), '{"evidence":"keep"}');
    const unrelated = JSON.parse(await readFile(join(dir, '.owx/state/sessions/unrelated/ralph-state.json'), 'utf8'));
    assert.equal(unrelated.active, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
