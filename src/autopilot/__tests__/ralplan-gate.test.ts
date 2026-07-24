import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { subagentTrackingPath } from '../../subagents/tracker.js';
import {
  buildAutopilotRalplanUltragoalGateError,
  canAdvanceAutopilotRalplanToUltragoal,
} from '../ralplan-gate.js';

describe('autopilot ralplan gate', () => {
  it('rejects native review evidence from the session leader even when malformed tracking marks it as subagent', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-autopilot-ralplan-leader-spoof-'));
    const sessionId = 'sess-autopilot-leader-spoof';
    const trackingPath = subagentTrackingPath(cwd);
    try {
      await mkdir(join(trackingPath, '..'), { recursive: true });
      await writeFile(join(cwd, '.owx', 'state', 'session.json'), JSON.stringify({
        session_id: sessionId,
        native_session_id: 'thread-leader',
      }, null, 2));
      await writeFile(trackingPath, JSON.stringify({
        schemaVersion: 1,
        sessions: {
          [sessionId]: {
            session_id: sessionId,
            leader_thread_id: 'thread-leader',
            updated_at: '2026-05-28T18:34:51.000Z',
            threads: {
              'thread-leader': {
                thread_id: 'thread-leader',
                kind: 'subagent',
                first_seen_at: '2026-05-28T18:34:51.000Z',
                last_seen_at: '2026-05-28T18:34:51.000Z',
                turn_count: 2,
              },
              'thread-critic': {
                thread_id: 'thread-critic',
                kind: 'subagent',
                first_seen_at: '2026-05-28T18:35:10.000Z',
                last_seen_at: '2026-05-28T18:35:10.000Z',
                turn_count: 1,
              },
            },
          },
        },
      }, null, 2));

      const state = {
        current_phase: 'ralplan',
        handoff_artifacts: {
          ralplan_consensus_gate: {
            complete: true,
            sequence: ['architect-review', 'critic-review'],
            ralplan_architect_review: {
              agent_role: 'architect',
              provenance_kind: 'native_subagent',
              verdict: 'approve',
              session_id: sessionId,
              thread_id: 'thread-leader',
              artifact_path: '.owx/artifacts/architect.md',
              tracker_path: '.owx/state/subagent-tracking.json',
              completed_at: '2026-05-28T18:34:51.000Z',
            },
            ralplan_critic_review: {
              agent_role: 'critic',
              provenance_kind: 'native_subagent',
              verdict: 'approve',
              session_id: sessionId,
              thread_id: 'thread-critic',
              artifact_path: '.owx/artifacts/critic.md',
              tracker_path: '.owx/state/subagent-tracking.json',
              completed_at: '2026-05-28T18:35:10.000Z',
            },
          },
        },
      };

      const decision = canAdvanceAutopilotRalplanToUltragoal({ cwd, sessionId, currentState: state });
      assert.equal(decision.allowed, false);
      assert.match(buildAutopilotRalplanUltragoalGateError(decision), /architect tracker thread thread-leader is the session leader/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects native review evidence when tracker leader id aliases a subagent lane', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-autopilot-ralplan-fresh-subagent-alias-'));
    const sessionId = 'sess-autopilot-fresh-subagent-alias';
    const trackingPath = subagentTrackingPath(cwd);
    try {
      await mkdir(join(trackingPath, '..'), { recursive: true });
      await writeFile(trackingPath, JSON.stringify({
        schemaVersion: 1,
        sessions: {
          [sessionId]: {
            session_id: sessionId,
            leader_thread_id: 'thread-architect',
            updated_at: '2026-05-28T18:35:10.000Z',
            threads: {
              'thread-architect': {
                thread_id: 'thread-architect',
                kind: 'subagent',
                first_seen_at: '2026-05-28T18:34:51.000Z',
                last_seen_at: '2026-05-28T18:34:51.000Z',
                turn_count: 1,
                mode: 'architect',
              },
              'thread-critic': {
                thread_id: 'thread-critic',
                kind: 'subagent',
                first_seen_at: '2026-05-28T18:35:10.000Z',
                last_seen_at: '2026-05-28T18:35:10.000Z',
                turn_count: 1,
                mode: 'critic',
              },
            },
          },
        },
      }, null, 2));

      const state = {
        current_phase: 'ralplan',
        handoff_artifacts: {
          ralplan_consensus_gate: {
            complete: true,
            sequence: ['architect-review', 'critic-review'],
            ralplan_architect_review: {
              agent_role: 'architect',
              provenance_kind: 'native_subagent',
              verdict: 'approve',
              session_id: sessionId,
              thread_id: 'thread-architect',
              artifact_path: '.owx/artifacts/architect.md',
              tracker_path: '.owx/state/subagent-tracking.json',
              completed_at: '2026-05-28T18:34:51.000Z',
            },
            ralplan_critic_review: {
              agent_role: 'critic',
              provenance_kind: 'native_subagent',
              verdict: 'approve',
              session_id: sessionId,
              thread_id: 'thread-critic',
              artifact_path: '.owx/artifacts/critic.md',
              tracker_path: '.owx/state/subagent-tracking.json',
              completed_at: '2026-05-28T18:35:10.000Z',
            },
          },
        },
      };

      const decision = canAdvanceAutopilotRalplanToUltragoal({ cwd, sessionId, currentState: state });
      assert.equal(decision.allowed, false);
      assert.match(buildAutopilotRalplanUltragoalGateError(decision), /architect tracker thread thread-architect is the session leader/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects self-declared review roles that do not match tracker lane modes', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-autopilot-ralplan-role-binding-'));
    const sessionId = 'sess-autopilot-role-binding';
    const trackingPath = subagentTrackingPath(cwd);
    try {
      await mkdir(join(trackingPath, '..'), { recursive: true });
      await writeFile(trackingPath, JSON.stringify({
        schemaVersion: 1,
        sessions: {
          [sessionId]: {
            session_id: sessionId,
            leader_thread_id: 'thread-leader',
            threads: {
              'thread-leader': { thread_id: 'thread-leader', kind: 'leader' },
              'thread-architect': { thread_id: 'thread-architect', kind: 'subagent', mode: 'critic' },
              'thread-critic': { thread_id: 'thread-critic', kind: 'subagent', mode: 'architect' },
            },
          },
        },
      }));
      const state = {
        current_phase: 'ralplan',
        handoff_artifacts: {
          ralplan_consensus_gate: {
            complete: true,
            sequence: ['architect-review', 'critic-review'],
            ralplan_architect_review: {
              agent_role: 'architect', provenance_kind: 'native_subagent', verdict: 'approve', session_id: sessionId,
              thread_id: 'thread-architect', artifact_path: '.owx/artifacts/architect.md', tracker_path: '.owx/state/subagent-tracking.json',
              completed_at: '2026-05-28T18:34:51.000Z',
            },
            ralplan_critic_review: {
              agent_role: 'critic', provenance_kind: 'native_subagent', verdict: 'approve', session_id: sessionId,
              thread_id: 'thread-critic', artifact_path: '.owx/artifacts/critic.md', tracker_path: '.owx/state/subagent-tracking.json',
              completed_at: '2026-05-28T18:35:10.000Z',
            },
          },
        },
      };

      const decision = canAdvanceAutopilotRalplanToUltragoal({ cwd, sessionId, currentState: state });
      assert.equal(decision.allowed, false);
      assert.match(buildAutopilotRalplanUltragoalGateError(decision), /architect tracker thread thread-architect has mode=critic/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects native review evidence from the current native session leader', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-autopilot-ralplan-native-leader-'));
    const sessionId = 'sess-autopilot-native-leader';
    const trackingPath = subagentTrackingPath(cwd);
    try {
      await mkdir(join(trackingPath, '..'), { recursive: true });
      await writeFile(join(cwd, '.owx', 'state', 'session.json'), JSON.stringify({
        session_id: sessionId,
        native_session_id: 'thread-leader',
      }, null, 2));
      await writeFile(trackingPath, JSON.stringify({
        schemaVersion: 1,
        sessions: {
          [sessionId]: {
            session_id: sessionId,
            leader_thread_id: 'thread-leader',
            updated_at: '2026-05-28T18:35:10.000Z',
            threads: {
              'thread-leader': {
                thread_id: 'thread-leader',
                kind: 'subagent',
                first_seen_at: '2026-05-28T18:34:51.000Z',
                last_seen_at: '2026-05-28T18:34:51.000Z',
                turn_count: 2,
              },
              'thread-critic': {
                thread_id: 'thread-critic',
                kind: 'subagent',
                first_seen_at: '2026-05-28T18:35:10.000Z',
                last_seen_at: '2026-05-28T18:35:10.000Z',
                turn_count: 1,
              },
            },
          },
        },
      }, null, 2));

      const state = {
        current_phase: 'ralplan',
        handoff_artifacts: {
          ralplan_consensus_gate: {
            complete: true,
            sequence: ['architect-review', 'critic-review'],
            ralplan_architect_review: {
              agent_role: 'architect',
              provenance_kind: 'native_subagent',
              verdict: 'approve',
              session_id: sessionId,
              thread_id: 'thread-leader',
              artifact_path: '.owx/artifacts/architect.md',
              tracker_path: '.owx/state/subagent-tracking.json',
              completed_at: '2026-05-28T18:34:51.000Z',
            },
            ralplan_critic_review: {
              agent_role: 'critic',
              provenance_kind: 'native_subagent',
              verdict: 'approve',
              session_id: sessionId,
              thread_id: 'thread-critic',
              artifact_path: '.owx/artifacts/critic.md',
              tracker_path: '.owx/state/subagent-tracking.json',
              completed_at: '2026-05-28T18:35:10.000Z',
            },
          },
        },
      };

      const decision = canAdvanceAutopilotRalplanToUltragoal({ cwd, sessionId, currentState: state });
      assert.equal(decision.allowed, false);
      assert.match(buildAutopilotRalplanUltragoalGateError(decision), /architect tracker thread thread-leader is the session leader/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('denies clean ultragoal handoff when session-scoped native support is unsupported', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-autopilot-ralplan-unsupported-native-'));
    const sessionId = 'sess-autopilot-ralplan-unsupported-native';
    try {
      const sessionDir = join(cwd, '.owx', 'state', 'sessions', sessionId);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(sessionDir, 'native-subagent-support.json'), JSON.stringify({
        schema_version: 1,
        status: 'unsupported',
        reason: 'native_subagents_unsupported',
        source: 'persisted_support_blocker',
        cwd,
        session_id: sessionId,
      }, null, 2));

      const decision = canAdvanceAutopilotRalplanToUltragoal({
        cwd,
        sessionId,
        currentState: { current_phase: 'ralplan' },
      });

      assert.equal(decision.allowed, false);
      assert.deepEqual(decision.nativeSubagentRecovery, {
        schema_version: 1,
        support: 'unsupported_native',
        outcome: 'blocked',
        clean: false,
        reason: 'native support is unavailable and recovery is terminal non-clean',
      });
      assert.match(buildAutopilotRalplanUltragoalGateError(decision), /native_subagent_recovery=/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('fails closed when persisted native support evidence is malformed', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-autopilot-ralplan-malformed-native-'));
    const sessionId = 'sess-autopilot-ralplan-malformed-native';
    try {
      const sessionDir = join(cwd, '.owx', 'state', 'sessions', sessionId);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(sessionDir, 'native-subagent-support.json'), '{malformed');

      assert.throws(() => canAdvanceAutopilotRalplanToUltragoal({
        cwd,
        sessionId,
        currentState: { current_phase: 'ralplan' },
      }), /JSON/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a cross-session unsupported blocker as recovery authority', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-autopilot-ralplan-cross-session-native-'));
    const sessionId = 'sess-autopilot-ralplan-cross-session-native';
    try {
      const sessionDir = join(cwd, '.owx', 'state', 'sessions', sessionId);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(sessionDir, 'native-subagent-support.json'), JSON.stringify({
        schema_version: 1,
        status: 'unsupported',
        reason: 'native_subagents_unsupported',
        source: 'persisted_support_blocker',
        cwd,
        session_id: 'different-session',
      }, null, 2));

      const decision = canAdvanceAutopilotRalplanToUltragoal({
        cwd,
        sessionId,
        currentState: { current_phase: 'ralplan' },
      });

      assert.equal(decision.allowed, false);
      assert.equal(decision.nativeSubagentRecovery, undefined);
      assert.doesNotMatch(decision.reason, /support is unavailable/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
