import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { basename, dirname, join, relative } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import type { StageContext } from '../types.js';
import { createDeepInterviewStage, buildDeepInterviewInstruction } from '../stages/deep-interview.js';
import { createRalplanStage } from '../stages/ralplan.js';
import { createRalphVerifyStage, createRalphStage, buildRalphInstruction } from '../stages/ralph-verify.js';
import { createCodeReviewStage, buildCodeReviewInstruction } from '../stages/code-review.js';
import { createUltragoalStage, buildUltragoalInstruction } from '../stages/ultragoal.js';
import { createUltraqaStage, buildUltraqaInstruction } from '../stages/ultraqa.js';
import { subagentTrackingPath } from '../../subagents/tracker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

function encodeApprovedExecutionTask(task: string, quote: 'single' | 'double'): string {
  return quote === 'single'
    ? `'${task.replace(/'/g, "\\'")}'`
    : `"${task.replace(/"/g, '\\"')}"`;
}

function computeGitBlobSha1(content: string): string {
  const buffer = Buffer.from(content, 'utf-8');
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf-8');
  return createHash('sha1').update(header).update(buffer).digest('hex');
}

function canonicalContextPackRelativePath(slug: string): string {
  return `.owx/context/context-20260507T120000Z-${slug}.json`;
}

function buildContextPackOutcome(relativePackPath: string): string {
  return [
    '## Context Pack Outcome',
    '',
    `- pack: created \`${relativePackPath}\``,
  ].join('\n');
}

async function writeReadyContextPack(
  cwd: string,
  slug: string,
  prdPath: string,
  testSpecPath: string,
): Promise<void> {
  const contextDir = join(cwd, '.owx', 'context');
  const packPath = join(cwd, canonicalContextPackRelativePath(slug));
  const prdContent = await readFile(prdPath, 'utf-8');
  const testSpecContent = await readFile(testSpecPath, 'utf-8');
  await mkdir(contextDir, { recursive: true });
  await writeFile(packPath, JSON.stringify({
    slug,
    basis: {
      prd: {
        path: relative(cwd, prdPath).replaceAll('\\', '/'),
        sha1: computeGitBlobSha1(prdContent),
      },
      testSpecs: [{
        path: relative(cwd, testSpecPath).replaceAll('\\', '/'),
        sha1: computeGitBlobSha1(testSpecContent),
      }],
    },
    entries: ['scope', 'build', 'verify'].map((role, index) => ({
      path: `src/${role}-${index}.ts`,
      roles: [role],
    })),
  }, null, 2));
}

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    task: 'test task',
    artifacts: {},
    cwd: tempDir,
    ...overrides,
  };
}

async function setup(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'owx-stages-test-'));
  return tempDir;
}

async function cleanup(): Promise<void> {
  if (tempDir && existsSync(tempDir)) {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function decodeRuntimeCliInstructionPayload(instruction: string): Record<string, unknown> {
  const match = instruction.match(/--input-json-base64\s+([A-Za-z0-9_-]+)/);
  assert.ok(match?.[1], 'expected --input-json-base64 payload');
  return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf-8')) as Record<string, unknown>;
}

async function writeNativeSubagentTracking(cwd: string, sessionId: string): Promise<void> {
  const trackingPath = subagentTrackingPath(cwd);
  const now = '2026-05-28T00:00:00.000Z';
  await mkdir(dirname(trackingPath), { recursive: true });
  await writeFile(trackingPath, JSON.stringify({
    schemaVersion: 1,
    sessions: {
      [sessionId]: {
        session_id: sessionId,
        leader_thread_id: 'thread-leader',
        updated_at: now,
        threads: {
          'thread-leader': { thread_id: 'thread-leader', kind: 'leader', first_seen_at: now, last_seen_at: now, turn_count: 1 },
          'thread-architect': { thread_id: 'thread-architect', kind: 'subagent', mode: 'architect', first_seen_at: now, last_seen_at: now, completed_at: now, turn_count: 1 },
          'thread-critic': { thread_id: 'thread-critic', kind: 'subagent', mode: 'critic', first_seen_at: now, last_seen_at: now, completed_at: now, turn_count: 1 },
        },
      },
    },
  }, null, 2));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// RALPLAN stage tests
// ---------------------------------------------------------------------------

describe('RALPLAN Stage', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('creates a stage with the correct name', () => {
    const stage = createRalplanStage();
    assert.equal(stage.name, 'ralplan');
  });

  it('fails closed without planning artifacts and consensus evidence', async () => {
    const stage = createRalplanStage();
    const result = await stage.run(makeCtx());

    assert.equal(result.status, 'failed');
    assert.equal((result.artifacts as Record<string, unknown>).stage, 'ralplan');
    assert.ok((result.artifacts as Record<string, unknown>).instruction);
    assert.equal(result.error, 'ralplan_planning_artifacts_missing');
  });

  it('fails strict ralplan with parseable non-clean recovery when native support is unsupported', async () => {
    const sessionId = 'sess-pipeline-native-unsupported';
    const sessionDir = join(tempDir, '.owx', 'state', 'sessions', sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'native-subagent-support.json'), JSON.stringify({
      schema_version: 1,
      status: 'unsupported',
      reason: 'native_subagents_unsupported',
      source: 'persisted_support_blocker',
      cwd: tempDir,
      session_id: sessionId,
    }, null, 2));
    const stage = createRalplanStage({ requireNativeSubagents: true });

    const result = await stage.run(makeCtx({ sessionId }));
    const artifacts = result.artifacts as Record<string, unknown>;

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'ralplan_native_subagent_support_unsupported');
    assert.deepEqual(artifacts.nativeSubagentRecovery, {
      schema_version: 1,
      support: 'unsupported_native',
      outcome: 'blocked',
      clean: false,
      reason: 'native support is unavailable and recovery is terminal non-clean',
    });
    assert.equal(stage.canSkip?.(makeCtx({ sessionId })), false);
  });

  it('fails closed when persisted native support evidence is malformed', async () => {
    const sessionId = 'sess-pipeline-native-malformed';
    const sessionDir = join(tempDir, '.owx', 'state', 'sessions', sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'native-subagent-support.json'), '{malformed');
    const stage = createRalplanStage({ requireNativeSubagents: true });

    const result = await stage.run(makeCtx({ sessionId }));
    assert.equal(result.status, 'failed');
    assert.match(result.error ?? '', /JSON/);
    assert.throws(() => stage.canSkip?.(makeCtx({ sessionId })), /JSON/);
  });

  it('canSkip returns false when no plans directory exists', () => {
    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx()), false);
  });

  it('canSkip returns false when plans directory is empty', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx()), false);
  });

  it('canSkip returns false when only a prd- plan file exists', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx()), false);
  });

  it('canSkip returns false when only prd and test spec plan files exist without consensus evidence', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx()), false);
  });

  it('run fails with consensus-specific artifact error when consensus exists but planning artifacts are missing', async () => {
    const stage = createRalplanStage();
    const result = await stage.run(makeCtx({
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            sequence: ['architect-review', 'critic-review'],
            ralplan_architect_review: { agent_role: 'architect', verdict: 'approve' },
            ralplan_critic_review: { agent_role: 'critic', verdict: 'approve' },
          },
        },
      },
    }));

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'ralplan_planning_artifacts_missing_after_consensus');
    assert.equal((result.artifacts as Record<string, unknown>).planningComplete, false);
  });

  it('canSkip returns true only when planning artifacts have sequential Architect and Critic approval evidence', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            ralplan_architect_review: { agent_role: 'architect', verdict: 'approve', summary: 'architect approved' },
            ralplan_critic_review: { agent_role: 'critic', verdict: 'approve', summary: 'critic approved after architect' },
          },
        },
      },
    })), true);
  });

  it('strict Autopilot canSkip rejects artifact-only or codex_exec consensus evidence', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage({ requireNativeSubagents: true });
    assert.equal(stage.canSkip!(makeCtx({
      sessionId: 'sess-native-required',
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            ralplan_architect_review: {
              agent_role: 'architect',
              verdict: 'approve',
              provenance_kind: 'codex_exec',
              session_id: 'sess-native-required',
              thread_id: 'exec-architect',
              artifact_path: '.owx/artifacts/architect.md',
              tracker_path: '.owx/state/subagent-tracking.json',
            },
            ralplan_critic_review: {
              agent_role: 'critic',
              verdict: 'approve',
              provenance_kind: 'codex_exec',
              session_id: 'sess-native-required',
              thread_id: 'exec-critic',
              artifact_path: '.owx/artifacts/critic.md',
              tracker_path: '.owx/state/subagent-tracking.json',
            },
          },
        },
      },
    })), false);
  });


  it('strict Autopilot canSkip rejects native reviews that reuse one subagent thread', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    const sessionId = 'sess-native-same-thread';
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');
    await writeNativeSubagentTracking(tempDir, sessionId);

    const stage = createRalplanStage({ requireNativeSubagents: true });
    assert.equal(stage.canSkip!(makeCtx({
      sessionId,
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            ralplan_architect_review: {
              agent_role: 'architect',
              verdict: 'approve',
              provenance_kind: 'native_subagent',
              session_id: sessionId,
              thread_id: 'thread-architect',
              artifact_path: '.owx/artifacts/architect.md',
              tracker_path: '.owx/state/subagent-tracking.json',
            },
            ralplan_critic_review: {
              agent_role: 'critic',
              verdict: 'approve',
              provenance_kind: 'native_subagent',
              session_id: sessionId,
              thread_id: 'thread-architect',
              artifact_path: '.owx/artifacts/critic.md',
              tracker_path: '.owx/state/subagent-tracking.json',
            },
          },
        },
      },
    })), false);
  });

  it('strict Autopilot canSkip accepts tracker-backed native Architect and Critic lanes', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    const sessionId = 'sess-native-required';
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');
    await writeNativeSubagentTracking(tempDir, sessionId);

    const stage = createRalplanStage({ requireNativeSubagents: true });
    assert.equal(stage.canSkip!(makeCtx({
      sessionId,
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            ralplan_architect_review: {
              agent_role: 'architect',
              verdict: 'approve',
              provenance_kind: 'native_subagent',
              session_id: sessionId,
              thread_id: 'thread-architect',
              artifact_path: '.owx/artifacts/architect.md',
              tracker_path: '.owx/state/subagent-tracking.json',
            },
            ralplan_critic_review: {
              agent_role: 'critic',
              verdict: 'approve',
              provenance_kind: 'native_subagent',
              session_id: sessionId,
              thread_id: 'thread-critic',
              artifact_path: '.owx/artifacts/critic.md',
              tracker_path: '.owx/state/subagent-tracking.json',
            },
          },
        },
      },
    })), true);
  });

  it('canSkip honors explicit session-scoped consensus state before root state', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    const stateDir = join(tempDir, '.owx', 'state');
    const sessionDir = join(stateDir, 'sessions', 'sess-explicit');
    await mkdir(plansDir, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');
    await writeFile(join(stateDir, 'autopilot-state.json'), JSON.stringify({
      state: {
        handoff_artifacts: {
          ralplan_architect_review: { agent_role: 'architect', verdict: 'reject', approved: true },
          ralplan_critic_review: { agent_role: 'critic', verdict: 'approve' },
        },
      },
    }));
    await writeFile(join(sessionDir, 'autopilot-state.json'), JSON.stringify({
      state: {
        handoff_artifacts: {
          ralplan_architect_review: { agent_role: 'architect', verdict: 'approve' },
          ralplan_critic_review: { agent_role: 'critic', verdict: 'approve' },
        },
      },
    }));

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({ sessionId: 'sess-explicit' })), true);
  });

  it('canSkip fails closed when explicit session state is missing despite root consensus', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    const stateDir = join(tempDir, '.owx', 'state');
    await mkdir(plansDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');
    await writeFile(join(stateDir, 'autopilot-state.json'), JSON.stringify({
      state: {
        handoff_artifacts: {
          ralplan_architect_review: { agent_role: 'architect', verdict: 'approve' },
          ralplan_critic_review: { agent_role: 'critic', verdict: 'approve' },
        },
      },
    }));

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({ sessionId: 'sess-missing' })), false);
  });

  it('canSkip fails closed for malformed explicit session ids instead of falling back to root consensus', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    const stateDir = join(tempDir, '.owx', 'state');
    await mkdir(plansDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');
    await writeFile(join(stateDir, 'ralplan-state.json'), JSON.stringify({
      ralplanConsensusGate: {
        complete: true,
        sequence: ['architect-review', 'critic-review'],
        ralplan_architect_review: { agent_role: 'architect', verdict: 'approve' },
        ralplan_critic_review: { agent_role: 'critic', verdict: 'approve' },
      },
    }));

    const stage = createRalplanStage();
    for (const sessionId of ['../bad', 'a'.repeat(65), '']) {
      assert.equal(stage.canSkip!(makeCtx({ sessionId })), false);
    }
  });

  it('canSkip rejects blocker aliases even with approval-shaped booleans', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    for (const blocker of [
      { blocking: true },
      { request_changes: true },
      { requestChanges: true },
      { status: 'request changes' },
      { recommendation: 'changes-requested' },
    ]) {
      assert.equal(stage.canSkip!(makeCtx({
        artifacts: {
          ralplan: {
            ralplanConsensusGate: {
              complete: true,
              ralplan_architect_review: { agent_role: 'architect', verdict: 'approve' },
              ralplan_critic_review: { agent_role: 'critic', approved: true, clean: true, ...blocker },
            },
          },
        },
      })), false);
    }
  });

  it('canSkip returns false when Critic evidence is recorded before Architect evidence', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            sequence: ['critic-review', 'architect-review'],
            ralplan_architect_review: { agent_role: 'architect', verdict: 'approve' },
            ralplan_critic_review: { agent_role: 'critic', verdict: 'approve' },
          },
        },
      },
    })), false);
  });

  it('canSkip returns false when Critic timestamp predates Architect timestamp', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            sequence: ['architect-review', 'critic-review'],
            ralplan_architect_review: {
              agent_role: 'architect',
              verdict: 'approve',
              completed_at: '2026-05-21T10:05:00.000Z',
            },
            ralplan_critic_review: {
              agent_role: 'critic',
              verdict: 'approve',
              completed_at: '2026-05-21T10:00:00.000Z',
            },
          },
        },
      },
    })), false);
  });

  it('canSkip honors consensus state from the configured OWX_ROOT', async () => {
    const ambientRoot = await mkdtemp(join(tmpdir(), 'owx-ralplan-ambient-'));
    const previousOmxRoot = process.env.OWX_ROOT;
    try {
      const plansDir = join(tempDir, '.owx', 'plans');
      await mkdir(plansDir, { recursive: true });
      await writeFile(join(plansDir, 'prd-local.md'), '# Plan\n');
      await writeFile(join(plansDir, 'test-spec-local.md'), '# Test Spec\n');

      const ambientStateDir = join(ambientRoot, '.owx', 'state');
      await mkdir(ambientStateDir, { recursive: true });
      await writeFile(join(ambientStateDir, 'ralplan-state.json'), JSON.stringify({
        current_phase: 'complete',
        planning_complete: true,
        ralplan_consensus_gate: {
          complete: true,
          ralplan_architect_review: { agent_role: 'architect', verdict: 'approve', iteration: 1 },
          ralplan_critic_review: { agent_role: 'critic', verdict: 'approve', iteration: 1 },
        },
      }));
      process.env.OWX_ROOT = ambientRoot;

      const stage = createRalplanStage();
      assert.equal(stage.canSkip!(makeCtx()), true);
    } finally {
      if (previousOmxRoot === undefined) delete process.env.OWX_ROOT;
      else process.env.OWX_ROOT = previousOmxRoot;
      await rm(ambientRoot, { recursive: true, force: true });
    }
  });

  it('canSkip returns false for rejected consensus objects with approval-shaped booleans', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            ralplan_architect_review: {
              agent_role: 'architect',
              verdict: 'reject',
              approved: true,
              clean: true,
            },
            ralplan_critic_review: {
              agent_role: 'critic',
              verdict: 'approve',
              approved: true,
              clean: true,
            },
          },
        },
      },
    })), false);
  });

  it('canSkip returns false when consensus-shaped reviews do not record agent roles', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            ralplan_architect_review: { verdict: 'approve', summary: 'role missing' },
            ralplan_critic_review: { verdict: 'approve', summary: 'role missing' },
          },
        },
      },
    })), false);
  });

  it('canSkip returns false when review history entries do not record agent roles', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        ralplan: {
          review_history: [{
            architect_review: { verdict: 'approve', summary: 'role missing' },
            critic_review: { verdict: 'approve', summary: 'role missing' },
          }],
        },
      },
    })), false);
  });

  it('canSkip returns false when review arrays do not record agent roles', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        ralplan: {
          architectReviews: [{ verdict: 'approve', summary: 'role missing' }],
          criticReviews: [{ verdict: 'approve', summary: 'role missing' }],
        },
      },
    })), false);
  });

  it('canSkip returns false when local state only has latest verdict fields', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    const stateDir = join(tempDir, '.owx', 'state');
    await mkdir(plansDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');
    await writeFile(join(stateDir, 'ralplan-state.json'), JSON.stringify({
      current_phase: 'complete',
      planning_complete: true,
      latest_architect_verdict: 'approve',
      latest_critic_verdict: 'approve',
    }));

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx()), false);
  });

  it('canSkip returns false when Architect and Critic roles are swapped', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        ralplan: {
          ralplanConsensusGate: {
            complete: true,
            ralplan_architect_review: { agent_role: 'critic', verdict: 'approve' },
            ralplan_critic_review: { agent_role: 'architect', verdict: 'approve' },
          },
        },
      },
    })), false);
  });

  it('canSkip returns false after non-clean code-review loopback even when plans exist', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        return_to_ralplan_reason: 'Review requested a plan update.',
        review_verdict: { recommendation: 'REQUEST CHANGES', architectural_status: 'CLEAR', clean: false },
      },
    })), false);
  });

  it('canSkip returns false when nested code-review artifacts are non-clean', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-my-feature.md'), '# Plan\n');
    await writeFile(join(plansDir, 'test-spec-my-feature.md'), '# Test Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx({
      artifacts: {
        'code-review': {
          review_verdict: { recommendation: 'COMMENT', architectural_status: 'CLEAR', clean: true },
          return_to_ralplan_reason: null,
        },
      },
    })), false);
  });

  it('surfaces deep-interview specs in ralplan artifacts for downstream traceability', async () => {
    const specsDir = join(tempDir, '.owx', 'specs');
    await mkdir(specsDir, { recursive: true });
    await writeFile(join(specsDir, 'deep-interview-my-feature.md'), '# Deep Interview Spec\n');

    const stage = createRalplanStage();
    const result = await stage.run(makeCtx());
    const artifacts = result.artifacts as Record<string, unknown>;

    assert.deepEqual(artifacts.deepInterviewSpecPaths, [join(specsDir, 'deep-interview-my-feature.md')]);
    assert.equal(artifacts.planningComplete, false);
  });

  it('can execute a real ralplan runtime when an executor is provided', async () => {
    const stage = createRalplanStage({
      executor: {
        async draft() {
          const plansDir = join(tempDir, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-runtime.md');
          await writeFile(prdPath, '# Runtime Plan\n');
          await writeFile(join(plansDir, 'test-spec-runtime.md'), '# Runtime Tests\n');
          return { summary: 'drafted', planPath: prdPath, artifacts: { runtimeDrafted: true } };
        },
        async architectReview() {
          return { verdict: 'approve', summary: 'architect ok' };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'critic ok' };
        },
      },
    });

    const result = await stage.run(makeCtx({ task: 'live ralplan run' }));
    const artifacts = result.artifacts as Record<string, unknown>;

    assert.equal(result.status, 'completed');
    assert.equal(result.error, undefined);
    assert.equal(artifacts.runtime, true);
    assert.equal(artifacts.planningComplete, true);
    assert.deepEqual(artifacts.ralplanConsensusGate, {
      complete: true,
      sequence: ['architect-review', 'critic-review'],
      ralplan_architect_review: { agent_role: 'architect', iteration: 1, verdict: 'approve', summary: 'architect ok' },
      ralplan_critic_review: { agent_role: 'critic', iteration: 1, verdict: 'approve', summary: 'critic ok' },
      source: 'runtime-result',
      blockedReason: null,
    });
    assert.equal(artifacts.iteration, 1);
    assert.equal(artifacts.runtimeDrafted, true);
  });

  it('fails runtime handoff when consensus approves but test spec does not match selected PRD', async () => {
    const stage = createRalplanStage({
      executor: {
        async draft() {
          const plansDir = join(tempDir, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-new.md');
          await writeFile(prdPath, '# New runtime plan\n');
          await writeFile(join(plansDir, 'test-spec-old.md'), '# Stale runtime tests\n');
          return { summary: 'drafted mismatched artifacts', planPath: prdPath };
        },
        async architectReview() {
          return { verdict: 'approve', summary: 'architect ok' };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'critic ok' };
        },
      },
    });

    const result = await stage.run(makeCtx({ task: 'live ralplan mismatched artifacts' }));
    const artifacts = result.artifacts as Record<string, unknown>;

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'ralplan_planning_artifacts_missing_after_consensus');
    assert.equal(artifacts.planningComplete, false);
    assert.equal((artifacts.ralplanConsensusGate as { complete?: boolean }).complete, true);
  });

  it('fails runtime handoff when consensus approves but required planning artifacts are missing', async () => {
    const stage = createRalplanStage({
      executor: {
        async draft() {
          return { summary: 'draft without files' };
        },
        async architectReview() {
          return { verdict: 'approve', summary: 'architect ok' };
        },
        async criticReview() {
          return { verdict: 'approve', summary: 'critic ok' };
        },
      },
    });

    const result = await stage.run(makeCtx({ task: 'live ralplan no artifacts' }));
    const artifacts = result.artifacts as Record<string, unknown>;

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'ralplan_planning_artifacts_missing_after_consensus');
    assert.equal(artifacts.planningComplete, false);
    assert.equal((artifacts.ralplanConsensusGate as { complete?: boolean }).complete, true);
  });

  it('fails runtime handoff when Critic has not approved after Architect', async () => {
    const stage = createRalplanStage({
      executor: {
        async draft() {
          const plansDir = join(tempDir, '.owx', 'plans');
          await mkdir(plansDir, { recursive: true });
          const prdPath = join(plansDir, 'prd-runtime.md');
          await writeFile(prdPath, '# Runtime Plan\n');
          await writeFile(join(plansDir, 'test-spec-runtime.md'), '# Runtime Tests\n');
          return { summary: 'drafted', planPath: prdPath };
        },
        async architectReview() {
          return { verdict: 'approve', summary: 'architect ok' };
        },
        async criticReview() {
          return { verdict: 'iterate', summary: 'critic needs changes' };
        },
      },
      maxIterations: 1,
    });

    const result = await stage.run(makeCtx({ task: 'live ralplan run' }));
    const artifacts = result.artifacts as Record<string, unknown>;

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'ralplan_consensus_not_reached_after_1_iterations');
    assert.deepEqual(artifacts.ralplanConsensusGate, {
      complete: false,
      sequence: ['architect-review', 'critic-review'],
      ralplan_architect_review: null,
      ralplan_critic_review: null,
      source: null,
      blockedReason: 'missing_sequential_architect_then_critic_approval',
    });
  });

  it('canSkip returns false for non-prd plan files', async () => {
    const plansDir = join(tempDir, '.owx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'autopilot-spec.md'), '# Spec\n');

    const stage = createRalplanStage();
    assert.equal(stage.canSkip!(makeCtx()), false);
  });
});

// ---------------------------------------------------------------------------
// Team exec stage tests
// ---------------------------------------------------------------------------

describe('Ralph Verify Stage', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('creates a stage with the correct name', () => {
    const stage = createRalphVerifyStage();
    assert.equal(stage.name, 'ralph-verify');
  });

  it('uses default max iterations of 10', async () => {
    const stage = createRalphVerifyStage();
    const result = await stage.run(makeCtx());

    assert.equal(result.status, 'completed');
    const arts = result.artifacts as Record<string, unknown>;
    assert.equal(arts.maxIterations, 10);
  });

  it('respects custom max iterations', async () => {
    const stage = createRalphVerifyStage({ maxIterations: 25 });
    const result = await stage.run(makeCtx());

    const arts = result.artifacts as Record<string, unknown>;
    assert.equal(arts.maxIterations, 25);
  });

  it('includes Ralph artifacts in verification context', async () => {
    const stage = createRalphVerifyStage();
    const ctx = makeCtx({
      artifacts: {
        ralph: { completed: true },
      },
    });
    const result = await stage.run(ctx);

    const descriptor = (result.artifacts as Record<string, unknown>).verifyDescriptor as Record<string, unknown>;
    const execArtifacts = descriptor.executionArtifacts as Record<string, unknown>;
    assert.equal(execArtifacts.completed, true);
    const rolePlan = descriptor.rolePlan as Record<string, unknown>;
    assert.ok(Array.isArray(rolePlan.availableAgentTypes));
    assert.ok(Array.isArray(rolePlan.recommendedAgentTypes));
  });

  describe('buildRalphInstruction', () => {
    it('includes max iterations in instruction', () => {
      const instruction = buildRalphInstruction({
        task: 'verify feature',
        maxIterations: 15,
        cwd: '/tmp',
        rolePlan: {
          availableAgentTypes: ['architect', 'executor', 'test-engineer'],
          recommendedAgentTypes: ['executor', 'test-engineer', 'architect'],
          summary: 'Use native agent types.',
        },
        executionArtifacts: {},
      });

      assert.match(instruction, /max_iterations=15/);
      assert.match(instruction, /^\$ralph /);
      assert.match(instruction, /verify feature/);
      assert.match(instruction, /native agent types/);
    });

    it('still emits a launch instruction for long task descriptions', () => {
      const longTask = 'b'.repeat(500);
      const instruction = buildRalphInstruction({
        task: longTask,
        maxIterations: 10,
        cwd: '/tmp',
        rolePlan: {
          availableAgentTypes: ['architect', 'executor', 'test-engineer'],
          recommendedAgentTypes: ['executor', 'test-engineer', 'architect'],
          summary: 'Use native agent types.',
        },
        executionArtifacts: {},
      });

      assert.match(instruction, /^\$ralph /);
    });
  });
});


// ---------------------------------------------------------------------------
// Strict Autopilot stage tests
// ---------------------------------------------------------------------------

describe('Explicit Legacy Ralph Stage', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('uses the explicit legacy phase name ralph', () => {
    assert.equal(createRalphStage().name, 'ralph');
  });

  it('uses ralplan artifacts as the primary explicit legacy Ralph execution input', async () => {
    const result = await createRalphStage().run(makeCtx({
      artifacts: {
        ralplan: { plan: 'approved plan' },
      },
    }));

    const descriptor = (result.artifacts as Record<string, unknown>).verifyDescriptor as Record<string, unknown>;
    assert.deepEqual(descriptor.executionArtifacts, { plan: 'approved plan' });
  });
});


describe('Default Autopilot Ultragoal Stage Adapters', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('creates a deep-interview descriptor and instruction', async () => {
    const stage = createDeepInterviewStage();
    assert.equal(stage.name, 'deep-interview');
    const result = await stage.run(makeCtx());
    const artifacts = result.artifacts as Record<string, unknown>;
    assert.equal(artifacts.stage, 'deep-interview');
    assert.match(artifacts.instruction as string, /^\$deep-interview /);
    assert.match(buildDeepInterviewInstruction('clarify me'), /^\$deep-interview /);
  });

  it('creates an ultragoal descriptor without a Team launch contract', async () => {
    const stage = createUltragoalStage();
    assert.equal(stage.name, 'ultragoal');
    const result = await stage.run(makeCtx({ artifacts: { ralplan: { plan: 'approved' } } }));
    const artifacts = result.artifacts as Record<string, unknown>;
    const descriptor = artifacts.ultragoalDescriptor as Record<string, unknown>;
    assert.equal(artifacts.stage, 'ultragoal');
    assert.deepEqual(descriptor.ralplanArtifacts, { plan: 'approved' });
    assert.equal('team_condition' in artifacts, false);
    assert.match(buildUltragoalInstruction('execute me'), /^\$ultragoal /);
  });

  it('creates an ultraqa gate that fails closed without evidence and can record clean skips', async () => {
    const missingEvidence = await createUltraqaStage().run(makeCtx({
      artifacts: { ultragoal: { tests: 'passed' }, 'code-review': { review_verdict: { clean: true } } },
    }));
    const missingArtifacts = missingEvidence.artifacts as Record<string, unknown>;
    const missingVerdict = missingArtifacts.qa_verdict as Record<string, unknown>;
    assert.equal(missingVerdict.clean, false);
    assert.equal(missingArtifacts.return_to_ralplan_reason, 'UltraQA evidence missing; fail closed and return to ralplan.');

    const skipped = await createUltraqaStage({ skipped: true, summary: 'Docs-only change; QA not applicable.' }).run(makeCtx());
    const skippedArtifacts = skipped.artifacts as Record<string, unknown>;
    const skippedVerdict = skippedArtifacts.qa_verdict as Record<string, unknown>;
    assert.equal(skippedVerdict.clean, true);
    assert.equal(skippedVerdict.skipped, true);
    assert.equal(skippedArtifacts.return_to_ralplan_reason, null);
    assert.match(buildUltraqaInstruction('qa me'), /^\$ultraqa /);
  });
});

describe('Code Review Stage', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('creates a code-review stage that fails closed without review evidence', async () => {
    const stage = createCodeReviewStage();
    assert.equal(stage.name, 'code-review');
    const result = await stage.run(makeCtx({ artifacts: { ultragoal: { tests: 'passed' } } }));
    const artifacts = result.artifacts as Record<string, unknown>;
    const descriptor = artifacts.codeReviewDescriptor as Record<string, unknown>;
    assert.deepEqual(descriptor.executionArtifacts, { tests: 'passed' });
    const verdict = artifacts.review_verdict as Record<string, unknown>;
    assert.equal(result.status, 'completed');
    assert.equal(verdict.clean, false);
    assert.equal(verdict.recommendation, 'REQUEST CHANGES');
    assert.equal(verdict.architectural_status, 'BLOCK');
    assert.equal(artifacts.return_to_ralplan_reason, 'Code-review evidence missing; fail closed and return to ralplan.');
  });

  it('marks explicit approve and clear review evidence as clean', async () => {
    const stage = createCodeReviewStage({ recommendation: 'APPROVE', architecturalStatus: 'CLEAR' });
    const result = await stage.run(makeCtx({ artifacts: { ralph: { tests: 'passed' } } }));
    const artifacts = result.artifacts as Record<string, unknown>;
    const verdict = artifacts.review_verdict as Record<string, unknown>;
    assert.equal(verdict.clean, true);
    assert.equal(verdict.recommendation, 'APPROVE');
    assert.equal(verdict.architectural_status, 'CLEAR');
    assert.equal(artifacts.return_to_ralplan_reason, null);
  });

  it('marks non-clean review as return-to-ralplan input', async () => {
    const stage = createCodeReviewStage({ recommendation: 'REQUEST CHANGES', architecturalStatus: 'BLOCK', summary: 'fix review findings' });
    const result = await stage.run(makeCtx());
    const artifacts = result.artifacts as Record<string, unknown>;
    const verdict = artifacts.review_verdict as Record<string, unknown>;
    assert.equal(verdict.clean, false);
    assert.equal(artifacts.return_to_ralplan_reason, 'fix review findings');
  });

  it('builds a code-review instruction', () => {
    assert.match(buildCodeReviewInstruction('review me'), /^\$code-review /);
  });
});
