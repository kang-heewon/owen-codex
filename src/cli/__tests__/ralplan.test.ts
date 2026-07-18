import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { parseRoleIntentCorrelationToken } from '../../leader/contract.js';

const cliPath = join(process.cwd(), 'dist', 'cli', 'owx.js');

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

describe('ralplan role-intent CLI', () => {
  it('fails closed when no authenticated leader anchor exists', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-no-anchor-'));
    try {
      const result = spawnSync(process.execPath, [
        cliPath,
        'ralplan',
        'role-intent',
        'write',
        '--role',
        'architect',
        '--parent-thread',
        'leader',
        '--json',
      ], { cwd, encoding: 'utf-8' });
      assert.equal(result.status, 1);
      assert.deepEqual(JSON.parse(result.stdout), { ok: false, reason: 'native_anchor_unavailable' });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns an App-compatible task_name for an attested leader', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-attested-'));
    try {
      const stateDir = join(cwd, '.owx', 'state');
      const sessionId = 'session-app';
      const leaderThreadId = 'thread-leader';
      await writeJson(join(stateDir, 'session.json'), {
        session_id: sessionId,
        native_session_id: leaderThreadId,
        cwd,
      });
      await writeJson(join(stateDir, 'subagent-tracking.json'), {
        schemaVersion: 1,
        sessions: {
          [sessionId]: {
            session_id: sessionId,
            leader_thread_id: leaderThreadId,
            leader_attested_at: '2026-07-16T00:00:00.000Z',
            leader_attest_source: 'native-pretooluse',
            updated_at: '2026-07-16T00:00:00.000Z',
            threads: {
              [leaderThreadId]: {
                thread_id: leaderThreadId,
                kind: 'leader',
                first_seen_at: '2026-07-16T00:00:00.000Z',
                last_seen_at: '2026-07-16T00:00:00.000Z',
                turn_count: 1,
              },
            },
          },
        },
        pending_role_intents: [],
      });

      const result = spawnSync(process.execPath, [
        cliPath,
        'ralplan',
        'role-intent',
        'write',
        '--role',
        'architect',
        '--parent-thread',
        leaderThreadId,
        '--json',
      ], { cwd, encoding: 'utf-8' });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const receipt = JSON.parse(result.stdout) as {
        ok: boolean;
        spawn_task_name: string;
        intent: { role: string; session_id: string; parent_thread_id: string; correlation_token: string };
      };
      assert.equal(receipt.ok, true);
      assert.equal(receipt.intent.role, 'architect');
      assert.equal(receipt.intent.session_id, sessionId);
      assert.equal(receipt.intent.parent_thread_id, leaderThreadId);
      assert.equal(parseRoleIntentCorrelationToken(receipt.spawn_task_name), receipt.intent.correlation_token);
      const tracking = JSON.parse(await readFile(join(stateDir, 'subagent-tracking.json'), 'utf-8')) as {
        pending_role_intents?: unknown[];
      };
      assert.equal(tracking.pending_role_intents?.length, 1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
