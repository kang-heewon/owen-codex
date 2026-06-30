import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { surfaceCommand } from '../surface.js';

async function captureSurfaceCommand(args: string[], options: { packageRoot?: string } = {}) {
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  const stdout: string[] = [];
  process.exitCode = undefined;
  console.log = (...values: unknown[]) => {
    stdout.push(values.join(' '));
  };
  try {
    await surfaceCommand(args, '  owx surface   Inspect surface\n', options);
    return {
      exitCode: process.exitCode,
      stdout: stdout.join('\n'),
    };
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
}

describe('cli/surface command handler', () => {
  it('emits JSON failure payloads when the registry cannot load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owx-surface-command-missing-registry-'));
    try {
      const result = await captureSurfaceCommand(['check', '--json'], { packageRoot: root });
      const payload = JSON.parse(result.stdout) as {
        status?: string;
        checks?: Array<{ name?: string; status?: string }>;
        issues?: Array<{ code?: string }>;
      };

      assert.equal(result.exitCode, 1);
      assert.equal(payload.status, 'failed');
      assert.ok(payload.checks?.some((check) => check.name === 'surface-registry-load' && check.status === 'failed'));
      assert.equal(payload.issues?.[0]?.code, 'surface_registry_load_failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits human-readable failure payloads when the registry cannot load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owx-surface-command-missing-registry-'));
    try {
      const result = await captureSurfaceCommand(['check'], { packageRoot: root });

      assert.equal(result.exitCode, 1);
      assert.match(result.stdout, /Surface check failed/);
      assert.match(result.stdout, /surface-registry-load: failed/);
      assert.match(result.stdout, /surface_registry_load_failed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
