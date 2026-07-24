import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { createHookPluginSdk, clearHookPluginState } from '../sdk.js';
import type { HookEventEnvelope } from '../types.js';

function makeEvent(event = 'session-start'): HookEventEnvelope {
  return {
    schema_version: '1',
    event,
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'native',
    context: {},
  };
}

async function writeOmxStateFile(cwd: string, fileName: string, value: unknown): Promise<void> {
  const stateDir = join(cwd, '.owx', 'state');
  const targetPath = join(stateDir, fileName);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(value, null, 2));
}

describe('createHookPluginSdk', () => {
  describe('state', () => {
    it('reads undefined for missing key', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        const val = await sdk.state.read('nonexistent');
        assert.equal(val, undefined);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('returns fallback for missing key', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        const val = await sdk.state.read('missing', 42);
        assert.equal(val, 42);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('writes and reads state', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        await sdk.state.write('counter', 5);
        const val = await sdk.state.read('counter');
        assert.equal(val, 5);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('deletes state key', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        await sdk.state.write('key', 'value');
        await sdk.state.delete('key');
        const val = await sdk.state.read('key');
        assert.equal(val, undefined);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('delete is a no-op for nonexistent key', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        await sdk.state.write('keep', 'yes');
        await sdk.state.delete('nonexistent');
        const val = await sdk.state.read('keep');
        assert.equal(val, 'yes');
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('reads all state', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        await sdk.state.write('a', 1);
        await sdk.state.write('b', 'two');
        const all = await sdk.state.all();
        assert.deepEqual(all, { a: 1, b: 'two' });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('returns empty object for all() with no state', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        const all = await sdk.state.all();
        assert.deepEqual(all, {});
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('rejects empty state key', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        await assert.rejects(() => sdk.state.read(''), /state key is required/);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('rejects state key with path traversal', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        await assert.rejects(() => sdk.state.read('../escape'), /invalid state key/);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('rejects state key starting with /', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        await assert.rejects(() => sdk.state.write('/absolute', 1), /invalid state key/);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe('log', () => {
    it('exposes info, warn, error methods', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        // These should not throw
        await sdk.log.info('test info');
        await sdk.log.warn('test warn');
        await sdk.log.error('test error');
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe('owx', () => {
    it('exposes only the explicit read-only owx readers', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });

        assert.deepEqual(Object.keys(sdk.owx).sort(), ['hud', 'session', 'updateCheck']);
        assert.equal(typeof sdk.owx.session.read, 'function');
        assert.equal(typeof sdk.owx.hud.read, 'function');
        assert.equal(typeof sdk.owx.updateCheck.read, 'function');
        assert.equal('pluginState' in sdk, false);
        assert.equal('readJson' in sdk.owx, false);
        assert.equal('list' in sdk.owx, false);
        assert.equal('exists' in sdk.owx, false);
        assert.equal('write' in sdk.owx.session, false);
        assert.equal('delete' in sdk.owx.session, false);
        assert.equal('write' in sdk.owx.hud, false);
        assert.equal('delete' in sdk.owx.hud, false);
        assert.equal('write' in sdk.owx.updateCheck, false);
        assert.equal('delete' in sdk.owx.updateCheck, false);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('reads session state from .owx/state/session.json', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        await writeOmxStateFile(cwd, 'session.json', {
          session_id: 'session-123',
          cwd,
          started_at: '2026-01-01T00:00:00.000Z',
        });

        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        const state = await sdk.owx.session.read();
        assert.deepEqual(state, {
          session_id: 'session-123',
          cwd,
          started_at: '2026-01-01T00:00:00.000Z',
        });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('returns null for invalid session state without session_id', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        await writeOmxStateFile(cwd, 'session.json', {
          started_at: '2026-01-01T00:00:00.000Z',
        });

        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        assert.equal(await sdk.owx.session.read(), null);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('reads hud and updateCheck state from root-scoped owx files', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        await writeOmxStateFile(cwd, 'hud-state.json', {
          last_turn_at: '2026-01-01T00:00:00.000Z',
          turn_count: 3,
        });
        await writeOmxStateFile(cwd, 'update-check.json', {
          last_checked_at: '2026-01-01T00:00:00.000Z',
          last_seen_latest: '0.11.0',
        });

        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        assert.deepEqual(await sdk.owx.hud.read(), {
          last_turn_at: '2026-01-01T00:00:00.000Z',
          turn_count: 3,
        });
        assert.deepEqual(await sdk.owx.updateCheck.read(), {
          last_checked_at: '2026-01-01T00:00:00.000Z',
          last_seen_latest: '0.11.0',
        });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('reads hud state from the current session scope instead of stale root fallback', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-hud-session-'));
      try {
        await writeOmxStateFile(cwd, 'session.json', {
          session_id: 'sess-current',
          cwd,
          started_at: '2026-01-01T00:00:00.000Z',
        });
        await writeOmxStateFile(cwd, 'hud-state.json', {
          last_turn_at: 'root-stale',
          turn_count: 99,
          last_agent_output: 'Would you like me to continue?',
        });
        await writeOmxStateFile(cwd, join('sessions', 'sess-current', 'hud-state.json'), {
          last_turn_at: '2026-01-01T00:00:00.000Z',
          turn_count: 3,
          last_agent_output: 'Current session output',
        });

        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        assert.deepEqual(await sdk.owx.hud.read(), {
          last_turn_at: '2026-01-01T00:00:00.000Z',
          turn_count: 3,
          last_agent_output: 'Current session output',
        });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it('returns null for missing owx reader files', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({ cwd, pluginName: 'test', event: makeEvent() });
        assert.equal(await sdk.owx.session.read(), null);
        assert.equal(await sdk.owx.hud.read(), null);
        assert.equal(await sdk.owx.updateCheck.read(), null);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe('plugin name sanitization', () => {
    it('sanitizes special characters in plugin name', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'owx-sdk-'));
      try {
        const sdk = createHookPluginSdk({
          cwd,
          pluginName: 'my plugin!@#',
          event: makeEvent(),
        });
        await sdk.state.write('test', 'value');
        const val = await sdk.state.read('test');
        assert.equal(val, 'value');
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });
});

describe('clearHookPluginState', () => {
  it('removes data.json for plugin', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-clear-'));
    try {
      const pluginDir = join(cwd, '.owx', 'state', 'hooks', 'plugins', 'my-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(join(pluginDir, 'data.json'), '{}');

      await clearHookPluginState(cwd, 'my-plugin');

      assert.equal(existsSync(join(pluginDir, 'data.json')), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('does not throw when files do not exist', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-clear-'));
    try {
      await clearHookPluginState(cwd, 'nonexistent');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
