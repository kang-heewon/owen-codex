import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSubagentTrackingState,
  evaluateNativeSubagentRecovery,
  isUnsupportedNativeSubagentEvidenceForScope,
  normalizeSubagentTrackingState,
  recordSubagentTurn,
  resolveNativeSubagentSupportStatus,
  summarizeSubagentSession,
} from '../tracker.js';

describe('subagents/tracker', () => {
  it('does not normalize a missing or invalid thread kind into trusted subagent identity', () => {
    const normalized = normalizeSubagentTrackingState({
      schemaVersion: 1,
      sessions: {
        'sess-invalid-kind': {
          session_id: 'sess-invalid-kind',
          updated_at: '2026-07-12T00:00:00.000Z',
          threads: {
            missing: { thread_id: 'missing', mode: 'executor' },
            invalid: { thread_id: 'invalid', kind: 'worker', mode: 'executor' },
          },
        },
      },
    });

    assert.deepEqual(normalized.sessions['sess-invalid-kind']?.threads, {});
  });

  it('tracks leader and subagent threads per session and computes active windows', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'leader-thread',
      turnId: 'turn-1',
      timestamp: '2026-03-17T00:00:00.000Z',
      mode: 'ralph',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'sub-thread-1',
      turnId: 'turn-2',
      timestamp: '2026-03-17T00:00:30.000Z',
      mode: 'ralph',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'sub-thread-2',
      turnId: 'turn-3',
      timestamp: '2026-03-17T00:01:00.000Z',
      mode: 'ralph',
    });

    const active = summarizeSubagentSession(state, 'sess-1', {
      now: '2026-03-17T00:01:15.000Z',
      activeWindowMs: 60_000,
    });
    assert.deepEqual(active, {
      sessionId: 'sess-1',
      leaderThreadId: 'leader-thread',
      allThreadIds: ['leader-thread', 'sub-thread-1', 'sub-thread-2'],
      allSubagentThreadIds: ['sub-thread-1', 'sub-thread-2'],
      activeSubagentThreadIds: ['sub-thread-1', 'sub-thread-2'],
      updatedAt: '2026-03-17T00:01:00.000Z',
    });

    const drained = summarizeSubagentSession(state, 'sess-1', {
      now: '2026-03-17T00:03:30.000Z',
      activeWindowMs: 60_000,
    });
    assert.deepEqual(drained?.activeSubagentThreadIds, []);
  });

  it('can record an explicitly spawned subagent as subagent even when it is the first seen thread', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-architect',
      timestamp: '2026-05-28T17:59:43.270Z',
      mode: 'architect',
      kind: 'subagent',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-critic',
      timestamp: '2026-05-28T18:01:49.547Z',
      mode: 'critic',
      kind: 'subagent',
    });

    const summary = summarizeSubagentSession(state, 'sess-ralplan', {
      now: '2026-05-28T18:02:00.000Z',
      activeWindowMs: 120_000,
    });

    assert.equal(state.sessions['sess-ralplan']?.leader_thread_id, undefined);
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-architect']?.kind, 'subagent');
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-critic']?.kind, 'subagent');
    assert.deepEqual(summary?.allSubagentThreadIds, ['thread-architect', 'thread-critic']);
  });

  it('keeps an explicitly spawned first-seen subagent as subagent after a generic follow-up turn', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-architect',
      timestamp: '2026-05-28T17:59:43.270Z',
      mode: 'architect',
      kind: 'subagent',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-architect',
      turnId: 'turn-after-session-start',
      timestamp: '2026-05-28T18:00:05.000Z',
      mode: 'architect',
    });

    assert.equal(state.sessions['sess-ralplan']?.leader_thread_id, undefined);
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-architect']?.kind, 'subagent');
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-architect']?.turn_count, 2);
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-architect']?.last_turn_id, 'turn-after-session-start');
  });

  it('does not promote existing subagent evidence when the same thread later acts as a parent', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-architect',
      timestamp: '2026-05-28T17:59:43.270Z',
      mode: 'architect',
      kind: 'subagent',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-architect',
      timestamp: '2026-05-28T18:00:10.000Z',
      mode: 'architect',
      kind: 'leader',
    });

    assert.equal(state.sessions['sess-ralplan']?.leader_thread_id, undefined);
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-architect']?.kind, 'subagent');
  });

  it('does not promote a known subagent when it becomes an immediate parent', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-architect',
      timestamp: '2026-05-28T17:59:43.270Z',
      mode: 'architect',
      kind: 'subagent',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-researcher',
      timestamp: '2026-05-28T18:00:10.000Z',
      mode: 'researcher',
      kind: 'subagent',
      leaderThreadId: 'thread-architect',
    });

    const summary = summarizeSubagentSession(state, 'sess-ralplan', {
      now: '2026-05-28T18:00:11.000Z',
      activeWindowMs: 120_000,
    });

    assert.equal(state.sessions['sess-ralplan']?.leader_thread_id, undefined);
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-architect']?.kind, 'subagent');
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-researcher']?.kind, 'subagent');
    assert.deepEqual(summary?.allSubagentThreadIds, ['thread-architect', 'thread-researcher']);
  });

  it('does not downgrade a known leader when later native metadata claims the same thread as subagent', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-leader',
      timestamp: '2026-05-28T17:59:40.000Z',
      mode: 'ralplan',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan',
      threadId: 'thread-leader',
      timestamp: '2026-05-28T17:59:43.270Z',
      mode: 'architect',
      kind: 'subagent',
    });

    assert.equal(state.sessions['sess-ralplan']?.leader_thread_id, 'thread-leader');
    assert.equal(state.sessions['sess-ralplan']?.threads['thread-leader']?.kind, 'leader');
  });

  it('excludes a corrupt leader thread from trusted subagent summaries even when kind is subagent', () => {
    const state = createSubagentTrackingState();
    state.sessions['sess-corrupt'] = {
      session_id: 'sess-corrupt',
      leader_thread_id: 'thread-leader',
      updated_at: '2026-05-28T19:04:17.000Z',
      threads: {
        'thread-leader': {
          thread_id: 'thread-leader',
          kind: 'subagent',
          first_seen_at: '2026-05-28T19:04:17.000Z',
          last_seen_at: '2026-05-28T19:04:17.000Z',
          turn_count: 2,
        },
        'thread-child': {
          thread_id: 'thread-child',
          kind: 'subagent',
          first_seen_at: '2026-05-28T19:04:18.000Z',
          last_seen_at: '2026-05-28T19:04:18.000Z',
          turn_count: 1,
        },
      },
    };

    const summary = summarizeSubagentSession(state, 'sess-corrupt', {
      now: '2026-05-28T19:04:19.000Z',
      activeWindowMs: 120_000,
    });

    assert.deepEqual(summary?.allSubagentThreadIds, ['thread-child']);
    assert.deepEqual(summary?.activeSubagentThreadIds, ['thread-child']);
  });

  it('reconciles completed subagent threads before reporting active wait state', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'leader-thread',
      turnId: 'turn-1',
      timestamp: '2026-03-17T00:00:00.000Z',
      mode: 'ralplan',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'sub-thread-1',
      turnId: 'turn-2',
      timestamp: '2026-03-17T00:00:30.000Z',
      mode: 'architect',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'sub-thread-1',
      turnId: 'turn-3',
      timestamp: '2026-03-17T00:00:45.000Z',
      mode: 'architect',
      completed: true,
      completionSource: 'native-stop-hook',
    });

    const summary = summarizeSubagentSession(state, 'sess-1', {
      now: '2026-03-17T00:01:00.000Z',
      activeWindowMs: 120_000,
    });

    assert.deepEqual(summary?.allSubagentThreadIds, ['sub-thread-1']);
    assert.deepEqual(summary?.activeSubagentThreadIds, []);
    assert.equal(state.sessions['sess-1']?.threads['sub-thread-1']?.completion_source, 'native-stop-hook');
  });

  it('reactivates a completed subagent thread after a later non-complete turn', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'leader-thread',
      turnId: 'turn-1',
      timestamp: '2026-03-17T00:00:00.000Z',
      mode: 'ralplan',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'sub-thread-1',
      turnId: 'turn-2',
      timestamp: '2026-03-17T00:00:30.000Z',
      mode: 'architect',
      completed: true,
      completionSource: 'native-stop-hook',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-1',
      threadId: 'sub-thread-1',
      turnId: 'turn-3',
      timestamp: '2026-03-17T00:01:00.000Z',
      mode: 'architect',
    });

    const summary = summarizeSubagentSession(state, 'sess-1', {
      now: '2026-03-17T00:01:15.000Z',
      activeWindowMs: 120_000,
    });
    const thread = state.sessions['sess-1']?.threads['sub-thread-1'];

    assert.deepEqual(summary?.activeSubagentThreadIds, ['sub-thread-1']);
    assert.equal(thread?.completed_at, undefined);
    assert.equal(thread?.last_completed_turn_id, undefined);
    assert.equal(thread?.completion_source, undefined);
    assert.equal(thread?.last_turn_id, 'turn-3');
  });

  it('preserves completion evidence and availability status for bookkeeping-only updates', () => {
    let state = createSubagentTrackingState();
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan-review',
      threadId: 'thread-architect',
      turnId: 'turn-completed',
      timestamp: '2026-07-02T00:00:00.000Z',
      mode: 'architect',
      kind: 'subagent',
      completed: true,
      completionSource: 'native-subagent-result',
      status: 'closed',
    });
    state = recordSubagentTurn(state, {
      sessionId: 'sess-ralplan-review',
      threadId: 'thread-architect',
      turnId: 'turn-bookkeeping',
      timestamp: '2026-07-02T00:01:00.000Z',
      mode: 'architect',
      kind: 'subagent',
      preserveCompletionEvidence: true,
    });

    const thread = state.sessions['sess-ralplan-review']?.threads['thread-architect'];
    assert.equal(thread?.completed_at, '2026-07-02T00:00:00.000Z');
    assert.equal(thread?.last_completed_turn_id, 'turn-completed');
    assert.equal(thread?.completion_source, 'native-subagent-result');
    assert.equal(thread?.status, 'closed');
    assert.equal(thread?.last_turn_id, 'turn-bookkeeping');
    assert.equal(thread?.turn_count, 2);
  });

  it('keeps persisted unsupported evidence monotonic over later supported payloads', () => {
    const evidence = resolveNativeSubagentSupportStatus({
      cwd: '/repo',
      sessionId: 'sess-unsupported',
      payload: { capabilities: { native_subagents: true } },
      persistedSupportBlocker: {
        status: 'unsupported',
        reason: 'native_subagents_unsupported',
        source: 'persisted_support_blocker',
        cwd: '/repo',
        session_id: 'sess-unsupported',
      },
    });

    assert.equal(evidence.status, 'unsupported');
    assert.equal(evidence.source, 'persisted_support_blocker');
    assert.equal(
      isUnsupportedNativeSubagentEvidenceForScope(evidence, {
        cwd: '/repo',
        sessionId: 'sess-unsupported',
      }),
      true,
    );
    assert.equal(
      isUnsupportedNativeSubagentEvidenceForScope(evidence, {
        cwd: '/repo',
        sessionId: 'other-session',
      }),
      false,
    );
  });

  it('treats capacity exhaustion as temporary unknown support, never unsupported', () => {
    const current = resolveNativeSubagentSupportStatus({
      cwd: '/repo',
      sessionId: 'sess-capacity',
      nowMs: Date.parse('2026-07-12T00:00:00.000Z'),
      persistedCapacityBlocker: {
        status: 'unknown',
        reason: 'agent_thread_limit_reached',
        source: 'capacity_blocker',
        cwd: '/repo',
        session_id: 'sess-capacity',
        expires_at: '2026-07-12T00:05:00.000Z',
      },
    });
    const expired = resolveNativeSubagentSupportStatus({
      cwd: '/repo',
      sessionId: 'sess-capacity',
      nowMs: Date.parse('2026-07-12T00:06:00.000Z'),
      persistedCapacityBlocker: {
        status: 'unknown',
        reason: 'agent_thread_limit_reached',
        source: 'capacity_blocker',
        cwd: '/repo',
        session_id: 'sess-capacity',
        expires_at: '2026-07-12T00:05:00.000Z',
      },
    });

    assert.equal(current.status, 'unknown');
    assert.equal(current.source, 'capacity_blocker');
    assert.equal(expired.status, 'unknown');
    assert.equal(expired.source, 'default_unknown');
  });

  it('recognizes App collaboration spawn and does not treat partial tool inventories as unsupported', () => {
    const app = resolveNativeSubagentSupportStatus({
      payload: { available_tools: ['collaboration.spawn_agent'] },
    });
    const partial = resolveNativeSubagentSupportStatus({
      payload: { available_tools: ['Read', 'Edit'] },
    });

    assert.equal(app.status, 'supported');
    assert.equal(app.source, 'hook_payload_available_tools');
    assert.equal(partial.status, 'unknown');
    assert.equal(partial.reason, undefined);
    assert.equal(partial.source, 'hook_payload_available_tools');
  });

  it('rejects forged or unscoped unsupported evidence', () => {
    assert.equal(
      isUnsupportedNativeSubagentEvidenceForScope(
        {
          status: 'unsupported',
          reason: 'native_subagents_unsupported',
          source: 'hook_payload_capability',
          cwd: '/repo',
          session_id: 'sess-forged',
        },
        { cwd: '/repo', sessionId: 'sess-forged' },
      ),
      false,
    );
    assert.equal(
      isUnsupportedNativeSubagentEvidenceForScope(
        {
          status: 'unsupported',
          reason: 'native_subagents_unsupported',
          source: 'persisted_support_blocker',
        },
        { cwd: '/repo', sessionId: 'sess-forged' },
      ),
      false,
    );
    assert.equal(
      resolveNativeSubagentSupportStatus({
        cwd: '/repo',
        sessionId: 'sess-forged',
        persistedSupportBlocker: {
          status: 'unsupported',
          reason: 'native_subagents_unsupported',
          source: 'hook_payload_capability',
          cwd: '/repo',
          session_id: 'sess-forged',
        },
      }).status,
      'unknown',
    );
  });

  it('enforces the closed native recovery outcome matrix', () => {
    assert.equal(evaluateNativeSubagentRecovery('supported_native', 'delegated').allowed, true);
    assert.equal(evaluateNativeSubagentRecovery('supported_native', 'completed').record.clean, true);
    assert.equal(evaluateNativeSubagentRecovery('supported_native', 'blocked').allowed, false);
    assert.equal(evaluateNativeSubagentRecovery('unsupported_native', 'blocked').allowed, true);
    assert.equal(evaluateNativeSubagentRecovery('unsupported_native', 'explicit_recovery_nonclean').allowed, true);
    assert.equal(evaluateNativeSubagentRecovery('unsupported_native', 'completed').allowed, false);
    assert.equal(evaluateNativeSubagentRecovery('unknown_native', 'blocked').allowed, false);
    assert.equal(evaluateNativeSubagentRecovery('unknown_native', 'explicit_recovery_nonclean').allowed, false);
  });
});
