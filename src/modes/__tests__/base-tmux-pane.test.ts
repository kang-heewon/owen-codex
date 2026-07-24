import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMode } from '../base.js';

const STATE_ENV_KEYS = [
  'OWX_ROOT',
  'OWX_STATE_ROOT',
  'OWX_TE\x41M_STATE_ROOT',
  'OWX_SESSION_ID',
  'CODEX_SESSION_ID',
  'SESSION_ID',
] as const;

async function withIsolatedStateEnv(fn: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of STATE_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    await fn();
  } finally {
    for (const key of STATE_ENV_KEYS) {
      const value = previous.get(key);
      if (typeof value === 'string') process.env[key] = value;
      else delete process.env[key];
    }
  }
}

describe('modes/base runtime-independent state', () => {
  it('does not capture terminal multiplexer context in mode state', async () => {
    await withIsolatedStateEnv(async () => {
      const prev = process.env.TMUX_PANE;
      process.env.TMUX_PANE = '%123';
      const wd = await mkdtemp(join(tmpdir(), 'owx-mode-pane-'));
      try {
        await startMode('ralph', 'test', 1, wd);
        const raw = JSON.parse(await readFile(join(wd, '.owx', 'state', 'ralph-state.json'), 'utf-8'));
        assert.equal('tmux_pane_id' in raw, false);
        assert.equal('tmux_window_id' in raw, false);
      } finally {
        if (typeof prev === 'string') process.env.TMUX_PANE = prev;
        else delete process.env.TMUX_PANE;
        await rm(wd, { recursive: true, force: true });
      }
    });
  });

  it('blocks exclusive mode startup when another exclusive state file is malformed', async () => {
    await withIsolatedStateEnv(async () => {
      const wd = await mkdtemp(join(tmpdir(), 'owx-mode-malformed-'));
      try {
        const stateDir = join(wd, '.owx', 'state');
        await mkdir(stateDir, { recursive: true });
        await writeFile(join(stateDir, 'ralph-state.json'), '{ "active": true');

        await assert.rejects(
          () => startMode('autopilot', 'test', 1, wd),
          /repair or clear that workflow state yourself via `owx state clear --input '\{"mode":"ralph"\}' --json`/i,
        );
      } finally {
        await rm(wd, { recursive: true, force: true });
      }
    });
  });
});
