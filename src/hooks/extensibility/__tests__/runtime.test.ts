import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { dispatchHookEventRuntime } from '../runtime.js';
import { buildHookEvent } from '../events.js';

describe('dispatchHookEventRuntime', () => {
  it('dispatches native events even when plugins env var is not set', async () => {
    const originalEnv = process.env.OWX_HOOK_PLUGINS;
    try {
      delete process.env.OWX_HOOK_PLUGINS;

      const cwd = await mkdtemp(join(tmpdir(), 'owx-hook-extensibility-'));
      try {
        const event = buildHookEvent('session-start');
        const result = await dispatchHookEventRuntime({ cwd, event });

        assert.equal(result.dispatched, true);
        assert.equal(result.reason, 'ok');
        assert.equal(result.result.enabled, true);
        assert.equal(result.result.plugin_count, 0);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    } finally {
      if (originalEnv !== undefined) {
        process.env.OWX_HOOK_PLUGINS = originalEnv;
      } else {
        delete process.env.OWX_HOOK_PLUGINS;
      }
    }
  });

  it('dispatches when plugins are enabled', async () => {
    const originalEnv = process.env.OWX_HOOK_PLUGINS;
    try {
      process.env.OWX_HOOK_PLUGINS = '1';

      const cwd = await mkdtemp(join(tmpdir(), 'owx-hook-extensibility-'));
      try {
        const dir = join(cwd, '.owx', 'hooks');
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, 'rt-test.mjs'),
          'export async function onHookEvent() {}',
        );

        const event = buildHookEvent('session-start');
        const result = await dispatchHookEventRuntime({ cwd, event });

        assert.equal(result.dispatched, true);
        assert.equal(result.reason, 'ok');
        assert.equal(result.result.enabled, true);
        assert.equal(result.result.plugin_count, 1);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    } finally {
      if (originalEnv !== undefined) {
        process.env.OWX_HOOK_PLUGINS = originalEnv;
      } else {
        delete process.env.OWX_HOOK_PLUGINS;
      }
    }
  });

  it('passes explicit side-effect policy through to dispatcher', async () => {
    const originalEnv = process.env.OWX_HOOK_PLUGINS;
    try {
      process.env.OWX_HOOK_PLUGINS = '1';

      const cwd = await mkdtemp(join(tmpdir(), 'owx-hook-extensibility-'));
      try {
        const event = buildHookEvent('turn-complete');
        const result = await dispatchHookEventRuntime({
          cwd,
          event,
          sideEffectsEnabled: false,
        });

        assert.equal(result.dispatched, true);
        assert.equal(result.result.enabled, true);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    } finally {
      if (originalEnv !== undefined) {
        process.env.OWX_HOOK_PLUGINS = originalEnv;
      } else {
        delete process.env.OWX_HOOK_PLUGINS;
      }
    }
  });

  it('returns event name and source in result', async () => {
    const originalEnv = process.env.OWX_HOOK_PLUGINS;
    try {
      delete process.env.OWX_HOOK_PLUGINS;

      const cwd = await mkdtemp(join(tmpdir(), 'owx-hook-extensibility-'));
      try {
        const event = buildHookEvent('needs-input');
        const result = await dispatchHookEventRuntime({ cwd, event });

        assert.equal(result.result.event, 'needs-input');
        assert.equal(result.result.source, 'derived');
        assert.equal(result.result.enabled, true);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    } finally {
      if (originalEnv !== undefined) {
        process.env.OWX_HOOK_PLUGINS = originalEnv;
      } else {
        delete process.env.OWX_HOOK_PLUGINS;
      }
    }
  });

});
