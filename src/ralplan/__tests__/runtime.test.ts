import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readModeState, startMode } from '../../modes/base.js';
import { getStatePath } from '../../state/paths.js';
import { subagentTrackingPath } from '../../subagents/tracker.js';
import { cancelRalplanConsensus, runRalplanConsensus } from '../runtime.js';

function sessionStatePath(cwd: string, sessionId: string): string {
  return getStatePath('ralplan', cwd, sessionId);
}

async function readScopedRalplanState(cwd: string, sessionId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(sessionStatePath(cwd, sessionId), 'utf-8'));
}

async function writeNativeSubagentTracking(cwd: string, sessionId: string): Promise<void> {
  const now = '2026-05-28T00:00:00.000Z';
  const trackingPath = subagentTrackingPath(cwd);
  await mkdir(join(trackingPath, '..'), { recursive: true });
  await writeFile(trackingPath, JSON.stringify({
    schemaVersion: 1,
    sessions: {
      [sessionId]: {
        session_id: sessionId,
        leader_thread_id: 'thread-leader',
        updated_at: now,
        threads: {
          'thread-leader': {
            thread_id: 'thread-leader',
            kind: 'leader',
            first_seen_at: now,
            last_seen_at: now,
            turn_count: 1,
          },
          'thread-architect': {
            thread_id: 'thread-architect',
            kind: 'subagent',
            mode: 'architect',
            first_seen_at: now,
            last_seen_at: now,
            completed_at: now,
            last_turn_id: 'turn-architect',
            last_completed_turn_id: 'turn-architect',
            completion_source: 'native-subagent-result',
            status: 'closed',
            turn_count: 1,
          },
          'thread-critic': {
            thread_id: 'thread-critic',
            kind: 'subagent',
            mode: 'critic',
            first_seen_at: now,
            last_seen_at: now,
            completed_at: now,
            last_turn_id: 'turn-critic',
            last_completed_turn_id: 'turn-critic',
            completion_source: 'native-subagent-result',
            status: 'closed',
            turn_count: 1,
          },
        },
      },
    },
  }, null, 2));
}

describe('ralplan runtime', () => {
  let savedOmxEnv: Pick<NodeJS.ProcessEnv, 'OWX_ROOT' | 'OWX_STATE_ROOT' | 'OWX_TEAM_STATE_ROOT' | 'OWX_SESSION_ID'>;

  beforeEach(() => {
    savedOmxEnv = {
      OWX_ROOT: process.env.OWX_ROOT,
      OWX_STATE_ROOT: process.env.OWX_STATE_ROOT,
      OWX_TEAM_STATE_ROOT: process.env.OWX_TEAM_STATE_ROOT,
      OWX_SESSION_ID: process.env.OWX_SESSION_ID,
    };
    delete process.env.OWX_ROOT;
    delete process.env.OWX_STATE_ROOT;
    delete process.env.OWX_TEAM_STATE_ROOT;
    delete process.env.OWX_SESSION_ID;
  });

  afterEach(() => {
    for (const key of ['OWX_ROOT', 'OWX_STATE_ROOT', 'OWX_TEAM_STATE_ROOT', 'OWX_SESSION_ID'] as const) {
      const value = savedOmxEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('persists a successful session-scoped lifecycle through complete', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-'));
    const sessionId = 'sess-ralplan-success';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const seenPhases: string[] = [];
      const result = await runRalplanConsensus({
        async draft(ctx) {
          const state = await readScopedRalplanState(cwd, sessionId);
          seenPhases.push(String(state.current_phase));
          assert.equal(state.current_phase, 'draft');
          assert.equal(state.iteration, 1);

          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-success.md');
          await writeFile(prdPath, '# plan\n');
          await writeFile(join(plansDir, 'test-spec-success.md'), '# tests\n');
          return { summary: `draft-${ctx.iteration}`, planPath: prdPath, artifacts: { drafted: true } };
        },
        async architectReview() {
          const state = await readScopedRalplanState(cwd, sessionId);
          seenPhases.push(String(state.current_phase));
          assert.equal(state.current_phase, 'architect-review');
          assert.equal(state.iteration, 1);
          return { verdict: 'approve', summary: 'architect-ok', artifacts: { architected: true } };
        },
        async criticReview() {
          const state = await readScopedRalplanState(cwd, sessionId);
          seenPhases.push(String(state.current_phase));
          assert.equal(state.current_phase, 'critic-review');
          assert.equal(state.iteration, 1);
          return { verdict: 'approve', summary: 'critic-ok', artifacts: { critiqued: true } };
        },
      }, { task: 'implement live ralplan runtime', cwd });

      assert.equal(result.status, 'completed');
      assert.equal(result.phase, 'complete');
      assert.equal(result.iteration, 1);
      assert.equal(result.planningComplete, true);
      assert.equal(result.architectReviews[0]?.agent_role, 'architect');
      assert.equal(result.criticReviews[0]?.agent_role, 'critic');
      assert.deepEqual(seenPhases, ['draft', 'architect-review', 'critic-review']);
      assert.equal(existsSync(join(cwd, '.owx', 'state', 'ralplan-state.json')), false);
      assert.equal(existsSync(sessionStatePath(cwd, sessionId)), true);

      const finalState = await readModeState('ralplan', cwd);
      assert.equal(finalState?.active, false);
      assert.equal(finalState?.current_phase, 'complete');
      assert.equal(finalState?.iteration, 1);
      assert.equal(finalState?.planning_complete, true);
      assert.match(String(finalState?.status_message || ''), /Status: complete/);
      assert.equal(finalState?.latest_architect_verdict, 'approve');
      assert.equal(finalState?.latest_critic_verdict, 'approve');
      assert.deepEqual(finalState?.ralplan_consensus_gate, {
        required: true,
        complete: true,
        sequence: ['architect-review', 'critic-review'],
        planning_artifacts_are_not_consensus: true,
        required_review_roles: ['architect', 'critic'],
        ralplan_architect_review: {
          agent_role: 'architect',
          iteration: 1,
          verdict: 'approve',
          summary: 'architect-ok',
          artifacts: { architected: true },
        },
        ralplan_critic_review: {
          agent_role: 'critic',
          iteration: 1,
          verdict: 'approve',
          summary: 'critic-ok',
          artifacts: { critiqued: true },
        },
        architect_review: {
          agent_role: 'architect',
          iteration: 1,
          verdict: 'approve',
          summary: 'architect-ok',
          artifacts: { architected: true },
        },
        critic_review: {
          agent_role: 'critic',
          iteration: 1,
          verdict: 'approve',
          summary: 'critic-ok',
          artifacts: { critiqued: true },
        },
        blocked_reason: null,
      });
      assert.equal(Array.isArray(finalState?.review_history), true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('fails Autopilot-required consensus when approvals lack native subagent provenance', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-native-required-missing-'));
    const sessionId = 'sess-ralplan-native-required-missing';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const result = await runRalplanConsensus({
        async draft() {
          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-native-missing.md');
          await writeFile(prdPath, '# plan\n');
          await writeFile(join(plansDir, 'test-spec-native-missing.md'), '# tests\n');
          return { summary: 'draft', planPath: prdPath };
        },
        async architectReview() {
          return { verdict: 'approve', summary: 'artifact-only architect ok' };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'artifact-only critic ok' };
        },
      }, {
        task: 'require native reviews',
        cwd,
        sessionId,
        maxIterations: 1,
        requireNativeSubagents: true,
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.ralplanConsensusGate.complete, false);
      assert.equal(result.ralplanConsensusGate.blocked_reason, 'architect_review_missing_or_not_approved');
      assert.match(result.error || '', /ralplan_architect_review_role_missing/);
      assert.equal(result.architectReviews.length, 0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a mismatched architect lane role before recording the review', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-role-mismatch-'));
    const sessionId = 'sess-ralplan-role-mismatch';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const result = await runRalplanConsensus({
        async draft() {
          return { summary: 'draft' };
        },
        async architectReview() {
          return {
            verdict: 'approve',
            summary: 'critic incorrectly used the architect lane',
            thread_id: 'thread-reviewer',
            agent_role: 'critic',
          };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'should not run' };
        },
      }, { task: 'reject mismatched review role', cwd, sessionId, maxIterations: 1 });

      assert.equal(result.status, 'failed');
      assert.match(result.error || '', /ralplan_architect_review_role_mismatch/);
      assert.equal(result.architectReviews.length, 0);
      assert.equal(existsSync(subagentTrackingPath(cwd)), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a thread-backed review that omits its lane role', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-thread-role-missing-'));
    const sessionId = 'sess-ralplan-thread-role-missing';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const result = await runRalplanConsensus({
        async draft() {
          return { summary: 'draft' };
        },
        async architectReview() {
          return {
            verdict: 'approve',
            summary: 'thread evidence without a role',
            thread_id: 'thread-architect',
          };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'should not run' };
        },
      }, { task: 'reject missing thread role', cwd, sessionId, maxIterations: 1 });

      assert.equal(result.status, 'failed');
      assert.match(result.error || '', /ralplan_architect_review_role_missing/);
      assert.equal(result.architectReviews.length, 0);
      assert.equal(existsSync(subagentTrackingPath(cwd)), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('accepts Autopilot-required consensus with tracker-backed native architect and critic lanes', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-native-required-ok-'));
    const sessionId = 'sess-ralplan-native-required-ok';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));
      await writeNativeSubagentTracking(cwd, sessionId);

      const result = await runRalplanConsensus({
        async draft() {
          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-native-ok.md');
          await writeFile(prdPath, '# plan\n');
          await writeFile(join(plansDir, 'test-spec-native-ok.md'), '# tests\n');
          return { summary: 'draft', planPath: prdPath };
        },
        async architectReview() {
          return {
            verdict: 'approve',
            summary: 'native architect ok',
            provenance_kind: 'native_subagent',
            session_id: sessionId,
            thread_id: 'thread-architect',
            artifact_path: '.owx/artifacts/architect.md',
            agent_role: 'architect',
            tracker_path: '.owx/state/subagent-tracking.json',
          };
        },
        async criticReview() {
          return {
            verdict: 'approve',
            summary: 'native critic ok',
            provenance_kind: 'native_subagent',
            session_id: sessionId,
            thread_id: 'thread-critic',
            artifact_path: '.owx/artifacts/critic.md',
            agent_role: 'critic',
            tracker_path: '.owx/state/subagent-tracking.json',
          };
        },
      }, {
        task: 'require native reviews',
        cwd,
        sessionId,
        maxIterations: 1,
        requireNativeSubagents: true,
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.ralplanConsensusGate.complete, true);
      assert.equal(result.ralplanConsensusGate.blocked_reason, null);
      assert.equal(result.ralplanConsensusGate.ralplan_architect_review?.thread_id, 'thread-architect');
      assert.equal(result.ralplanConsensusGate.ralplan_critic_review?.thread_id, 'thread-critic');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('does not let executor review output create native subagent provenance', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-native-provenance-laundering-'));
    const sessionId = 'sess-ralplan-native-provenance-laundering';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const result = await runRalplanConsensus({
        async draft() {
          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-native-provenance-laundering.md');
          await writeFile(prdPath, '# plan\n');
          await writeFile(join(plansDir, 'test-spec-native-provenance-laundering.md'), '# tests\n');
          return { summary: 'draft', planPath: prdPath };
        },
        async architectReview() {
          return {
            verdict: 'approve',
            provenance_kind: 'native_subagent',
            session_id: sessionId,
            thread_id: 'thread-architect-claimed',
            artifact_path: '.owx/artifacts/architect.md',
            agent_role: 'architect',
            tracker_path: '.owx/state/subagent-tracking.json',
          };
        },
        async criticReview() {
          return {
            verdict: 'approve',
            provenance_kind: 'native_subagent',
            session_id: sessionId,
            thread_id: 'thread-critic-claimed',
            artifact_path: '.owx/artifacts/critic.md',
            agent_role: 'critic',
            tracker_path: '.owx/state/subagent-tracking.json',
          };
        },
      }, {
        task: 'reject executor-created native provenance',
        cwd,
        sessionId,
        maxIterations: 1,
        requireNativeSubagents: true,
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.ralplanConsensusGate.complete, false);
      assert.equal(result.ralplanConsensusGate.blocked_reason, 'native_subagent_consensus_evidence_missing');
      assert.equal(existsSync(subagentTrackingPath(cwd)), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('does not disturb completed tracker evidence while consuming review results', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-preserve-review-completion-'));
    const sessionId = 'sess-ralplan-preserve-review-completion';
    const completedAt = '2026-05-28T00:00:00.000Z';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));
      await writeNativeSubagentTracking(cwd, sessionId);

      const result = await runRalplanConsensus({
        async draft() {
          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-preserve-review-completion.md');
          await writeFile(prdPath, '# plan\n');
          await writeFile(join(plansDir, 'test-spec-preserve-review-completion.md'), '# tests\n');
          return { summary: 'draft', planPath: prdPath };
        },
        async architectReview() {
          return {
            verdict: 'approve',
            summary: 'architect ok',
            thread_id: 'thread-architect',
            agent_role: 'architect',
          };
        },
        async criticReview() {
          return {
            verdict: 'approve',
            summary: 'critic ok',
            thread_id: 'thread-critic',
            agent_role: 'critic',
          };
        },
      }, {
        task: 'preserve completed review evidence',
        cwd,
        sessionId,
        maxIterations: 1,
      });

      assert.equal(result.status, 'completed');
      const tracking = JSON.parse(await readFile(subagentTrackingPath(cwd), 'utf-8')) as {
        sessions?: Record<string, { threads?: Record<string, {
          completed_at?: string;
          last_completed_turn_id?: string;
          completion_source?: string;
          status?: string;
        }> }>;
      };
      for (const [threadId, completedTurnId] of [
        ['thread-architect', 'turn-architect'],
        ['thread-critic', 'turn-critic'],
      ] as const) {
        const thread = tracking.sessions?.[sessionId]?.threads?.[threadId];
        assert.equal(thread?.completed_at, completedAt);
        assert.equal(thread?.last_completed_turn_id, completedTurnId);
        assert.equal(thread?.completion_source, 'native-subagent-result');
        assert.equal(thread?.status, 'closed');
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });


  it('fails Autopilot-required consensus when native reviews reuse one subagent thread', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-native-same-thread-'));
    const sessionId = 'sess-ralplan-native-same-thread';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));
      await writeNativeSubagentTracking(cwd, sessionId);

      const result = await runRalplanConsensus({
        async draft() {
          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-native-same-thread.md');
          await writeFile(prdPath, '# plan\n');
          await writeFile(join(plansDir, 'test-spec-native-same-thread.md'), '# tests\n');
          return { summary: 'draft', planPath: prdPath };
        },
        async architectReview() {
          return {
            verdict: 'approve',
            summary: 'native architect ok',
            provenance_kind: 'native_subagent',
            session_id: sessionId,
            thread_id: 'thread-architect',
            artifact_path: '.owx/artifacts/architect.md',
            agent_role: 'architect',
            tracker_path: '.owx/state/subagent-tracking.json',
          };
        },
        async criticReview() {
          return {
            verdict: 'approve',
            summary: 'native critic reuses architect thread',
            provenance_kind: 'native_subagent',
            session_id: sessionId,
            thread_id: 'thread-architect',
            artifact_path: '.owx/artifacts/critic.md',
            agent_role: 'critic',
            tracker_path: '.owx/state/subagent-tracking.json',
          };
        },
      }, {
        task: 'require distinct native reviews',
        cwd,
        sessionId,
        maxIterations: 1,
        requireNativeSubagents: true,
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.ralplanConsensusGate.complete, false);
      assert.equal(result.ralplanConsensusGate.blocked_reason, 'native_subagent_consensus_evidence_missing');
      assert.equal(result.error, 'ralplan_consensus_not_reached_after_1_iterations');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('does not complete or call Critic when Architect has not approved', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-architect-reject-'));
    const sessionId = 'sess-ralplan-architect-reject';
    try {
      await mkdir(join(cwd, '.owx', 'state'), { recursive: true });
      await writeFile(join(cwd, '.owx', 'state', 'session.json'), JSON.stringify({ session_id: sessionId }));

      let criticCalls = 0;
      const result = await runRalplanConsensus({
        async draft() {
          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-reject.md');
          await writeFile(prdPath, '# plan\n');
          await writeFile(join(plansDir, 'test-spec-reject.md'), '# tests\n');
          return { summary: 'draft', planPath: prdPath };
        },
        async architectReview() {
          return { verdict: 'iterate', summary: 'architect needs changes' };
        },
        async criticReview() {
          criticCalls += 1;
          return { verdict: 'approve', summary: 'should not run' };
        },
      }, { task: 'reject before critic', cwd, maxIterations: 1 });

      assert.equal(result.status, 'failed');
      assert.equal(criticCalls, 0);
      assert.equal(result.ralplanConsensusGate.complete, false);
      assert.equal(result.ralplanConsensusGate.blocked_reason, 'architect_review_missing_or_not_approved');

      const finalState = await readModeState('ralplan', cwd);
      assert.equal(finalState?.current_phase, 'failed');
      assert.equal((finalState?.ralplan_consensus_gate as { complete?: boolean } | undefined)?.complete, false);
      assert.equal(
        (finalState?.ralplan_consensus_gate as { ralplan_architect_review?: { agent_role?: string } } | undefined)?.ralplan_architect_review?.agent_role,
        'architect',
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('increments iteration when critic requests a re-review loop', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-loop-'));
    const sessionId = 'sess-ralplan-loop';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const draftIterations: number[] = [];
      const criticVerdicts: string[] = [];
      let criticCalls = 0;

      const result = await runRalplanConsensus({
        async draft(ctx) {
          const state = await readScopedRalplanState(cwd, sessionId);
          draftIterations.push(Number(state.iteration));
          assert.equal(state.current_phase, 'draft');

          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-loop.md');
          await writeFile(prdPath, '# loop plan\n');
          await writeFile(join(plansDir, 'test-spec-loop.md'), '# loop tests\n');
          return { summary: `draft-${ctx.iteration}`, planPath: prdPath };
        },
        async architectReview(ctx) {
          const state = await readScopedRalplanState(cwd, sessionId);
          assert.equal(state.current_phase, 'architect-review');
          return { verdict: 'approve', summary: `architect-${ctx.iteration}` };
        },
        async criticReview(ctx) {
          const state = await readScopedRalplanState(cwd, sessionId);
          assert.equal(state.current_phase, 'critic-review');
          criticCalls += 1;
          const verdict = criticCalls === 1 ? 'iterate' : 'approve';
          criticVerdicts.push(verdict);
          return { verdict, summary: `critic-${ctx.iteration}-${verdict}` };
        },
      }, { task: 'loop until approval', cwd, maxIterations: 3 });

      assert.equal(result.status, 'completed');
      assert.equal(result.iteration, 2);
      assert.deepEqual(draftIterations, [1, 2]);
      assert.deepEqual(criticVerdicts, ['iterate', 'approve']);

      const finalState = await readModeState('ralplan', cwd);
      assert.equal(finalState?.current_phase, 'complete');
      assert.equal(finalState?.iteration, 2);
      assert.equal((finalState?.review_history as Array<unknown>).length, 2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('does not complete when critic approves after an architect rejection', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-architect-reject-'));
    const sessionId = 'sess-ralplan-architect-reject';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));
      const plansDir = join(cwd, '.owx', 'plans');
      await mkdir(plansDir, { recursive: true });
      await writeFile(join(plansDir, 'prd-reject.md'), '# plan\n');
      await writeFile(join(plansDir, 'test-spec-reject.md'), '# tests\n');

      const result = await runRalplanConsensus({
        async draft() {
          return { summary: 'draft' };
        },
        async architectReview() {
          return { verdict: 'reject', summary: 'architect rejects' };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'critic approves malformed flow' };
        },
      }, { task: 'reject then approve must fail', cwd, maxIterations: 1 });

      assert.equal(result.status, 'failed');
      assert.equal(result.phase, 'failed');
      assert.equal(result.planningComplete, false);
      const finalState = await readModeState('ralplan', cwd);
      assert.equal(finalState?.current_phase, 'failed');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('fails closed when consensus approves with a mismatched stale test spec', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-mismatched-artifacts-'));
    const sessionId = 'sess-ralplan-mismatched-artifacts';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const result = await runRalplanConsensus({
        async draft() {
          const plansDir = join(cwd, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-new.md');
          await writeFile(prdPath, '# new plan\n');
          await writeFile(join(plansDir, 'test-spec-old.md'), '# old tests\n');
          return { summary: 'draft mismatched artifacts', planPath: prdPath };
        },
        async architectReview() {
          return { verdict: 'approve', summary: 'architect ok' };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'critic ok' };
        },
      }, { task: 'approve with mismatched artifacts', cwd, maxIterations: 1 });

      assert.equal(result.status, 'failed');
      assert.equal(result.phase, 'failed');
      assert.equal(result.planningComplete, false);
      assert.equal(result.error, 'ralplan_planning_artifacts_missing_after_consensus');
      assert.equal(result.ralplanConsensusGate.complete, true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('fails closed when consensus approves without required planning artifacts', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-no-artifacts-'));
    const sessionId = 'sess-ralplan-no-artifacts';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const result = await runRalplanConsensus({
        async draft() {
          return { summary: 'draft without prd/test spec' };
        },
        async architectReview() {
          return { verdict: 'approve', summary: 'architect ok' };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'critic ok' };
        },
      }, { task: 'approve without artifacts', cwd, maxIterations: 1 });

      assert.equal(result.status, 'failed');
      assert.equal(result.phase, 'failed');
      assert.equal(result.planningComplete, false);
      assert.equal(result.error, 'ralplan_planning_artifacts_missing_after_consensus');
      assert.equal(result.ralplanConsensusGate.complete, true);

      const finalState = await readModeState('ralplan', cwd);
      assert.equal(finalState?.current_phase, 'failed');
      assert.equal(finalState?.planning_complete, false);
      assert.equal(finalState?.error, 'ralplan_planning_artifacts_missing_after_consensus');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('marks failed cleanly when execution throws', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-fail-'));
    const sessionId = 'sess-ralplan-fail';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      const result = await runRalplanConsensus({
        async draft() {
          return { summary: 'draft' };
        },
        async architectReview() {
          throw new Error('architect blew up');
        },
        async criticReview() {
          throw new Error('should not run');
        },
      }, { task: 'failing ralplan runtime', cwd });

      assert.equal(result.status, 'failed');
      assert.match(result.error || '', /architect blew up/);

      const finalState = await readModeState('ralplan', cwd);
      assert.equal(finalState?.active, false);
      assert.equal(finalState?.current_phase, 'failed');
      assert.match(String(finalState?.status_message || ''), /Status: failed/);
      assert.match(String(finalState?.error || ''), /architect blew up/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('marks cancelled state cleanly', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-ralplan-runtime-cancel-'));
    const sessionId = 'sess-ralplan-cancel';
    try {
      await mkdir(join(sessionStatePath(cwd, sessionId), '..'), { recursive: true });
      await writeFile(join(sessionStatePath(cwd, sessionId), '..', '..', '..', 'session.json'), JSON.stringify({ session_id: sessionId }));

      await startMode('ralplan', 'cancel me', 2, cwd);
      await cancelRalplanConsensus(cwd);

      const finalState = await readModeState('ralplan', cwd);
      assert.equal(finalState?.active, false);
      assert.equal(finalState?.current_phase, 'cancelled');
      assert.ok(typeof finalState?.completed_at === 'string' && finalState.completed_at.length > 0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
