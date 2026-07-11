import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseWorktreeMode,
  planWorktreeTarget,
  ensureWorktree,
  renderCodeGraphInstructions,
  resolveWorktreeToolContext,
  rollbackProvisionedWorktrees,
  worktreeToolContextEnv,
} from '../worktree.js';

async function initRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'owx-worktree-test-'));
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd, stdio: 'ignore' });
  await writeFile(join(cwd, 'README.md'), 'hello\n', 'utf-8');
  execFileSync('git', ['add', 'README.md'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd, stdio: 'ignore' });
  return cwd;
}

function branchExists(repoRoot: string, branch: string): boolean {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('worktree parser', () => {
  it('parses detached mode from --worktree', () => {
    const parsed = parseWorktreeMode(['--worktree', '--yolo']);
    assert.deepEqual(parsed.mode, { enabled: true, detached: true, name: null });
    assert.deepEqual(parsed.remainingArgs, ['--yolo']);
  });

  it('parses named mode from --worktree=name', () => {
    const parsed = parseWorktreeMode(['--worktree=feature/foo', 'task']);
    assert.deepEqual(parsed.mode, { enabled: true, detached: false, name: 'feature/foo' });
    assert.deepEqual(parsed.remainingArgs, ['task']);
  });

  it('keeps args unchanged when worktree flag is absent', () => {
    const parsed = parseWorktreeMode(['team', '2:executor', 'task']);
    assert.deepEqual(parsed.mode, { enabled: false });
    assert.deepEqual(parsed.remainingArgs, ['team', '2:executor', 'task']);
  });

  it('keeps team args flag-free so the CLI can apply automatic default worktrees', () => {
    const parsed = parseWorktreeMode(['ralph', '2:executor', 'task']);
    assert.deepEqual(parsed.mode, { enabled: false });
    assert.deepEqual(parsed.remainingArgs, ['ralph', '2:executor', 'task']);
  });

  // Regression tests for issue #203: branch name passed as separate arg must not
  // leak into the Codex shell as input.
  it('parses named branch from --worktree <name> (space-separated)', () => {
    const parsed = parseWorktreeMode(['--worktree', 'my-branch']);
    assert.deepEqual(parsed.mode, { enabled: true, detached: false, name: 'my-branch' });
    assert.deepEqual(parsed.remainingArgs, []);
  });

  it('parses named branch from -w <name> (space-separated)', () => {
    const parsed = parseWorktreeMode(['-w', 'my-branch']);
    assert.deepEqual(parsed.mode, { enabled: true, detached: false, name: 'my-branch' });
    assert.deepEqual(parsed.remainingArgs, []);
  });

  it('does not leak branch name into remainingArgs when --worktree <name> is used with trailing args', () => {
    const parsed = parseWorktreeMode(['--worktree', 'feat/issue-203', '--yolo']);
    assert.deepEqual(parsed.mode, { enabled: true, detached: false, name: 'feat/issue-203' });
    assert.deepEqual(parsed.remainingArgs, ['--yolo']);
  });

  it('treats --worktree at end of args as detached', () => {
    const parsed = parseWorktreeMode(['--worktree']);
    assert.deepEqual(parsed.mode, { enabled: true, detached: true, name: null });
    assert.deepEqual(parsed.remainingArgs, []);
  });

  it('treats -w at end of args as detached', () => {
    const parsed = parseWorktreeMode(['-w']);
    assert.deepEqual(parsed.mode, { enabled: true, detached: true, name: null });
    assert.deepEqual(parsed.remainingArgs, []);
  });
});

describe('worktree planning', () => {
  it('plans dedicated autoresearch branch and path naming', async () => {
    const repo = await initRepo();
    try {
      const planned = planWorktreeTarget({
        cwd: repo,
        scope: 'autoresearch' as never,
        mode: { enabled: true, detached: false, name: 'demo-mission' },
        worktreeTag: '20260314T000000Z',
      });
      assert.equal(planned.enabled, true);
      if (!planned.enabled) return;

      assert.equal(planned.branchName, 'autoresearch/demo-mission/20260314t000000z');
      assert.match(planned.worktreePath.replace(/\\/g, '/'), /\.owx\/worktrees\/autoresearch-demo-mission-20260314t000000z$/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('worktree tool context', () => {
  it('fails closed outside a Git worktree instead of treating cwd as authoritative', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-worktree-context-non-git-'));
    try {
      assert.throws(
        () => resolveWorktreeToolContext({ cwd, scope: 'team', env: {} }),
        /worktree_tool_context_git_root_unresolved/,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('recomputes linked-worktree identity and ignores inherited parent paths', async () => {
    const repo = await initRepo();
    const worktreePath = `${repo}-tool-context`;
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'tool-context', worktreePath, 'HEAD'], {
        cwd: repo,
        stdio: 'ignore',
      });
      await mkdir(join(repo, '.codegraph'), { recursive: true });
      await writeFile(join(repo, '.codegraph', 'codegraph.db'), 'shared', 'utf-8');
      const canonicalRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: repo,
        encoding: 'utf-8',
      }).trim();
      const canonicalWorktree = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();

      const shared = resolveWorktreeToolContext({
        cwd: worktreePath,
        scope: 'team',
        env: {
          OWX_REPO_ROOT: '/stale/repo',
          OWX_WORKTREE_ROOT: '/stale/worktree',
          OWX_GIT_COMMON_DIR: '/stale/.git',
          OWX_CODEGRAPH_PROJECT_PATH: '/stale/project',
          OWX_CODEGRAPH_REQUESTED_MODE: 'invalid',
        },
      });

      assert.equal(shared.repoRoot, canonicalRepo);
      assert.equal(shared.worktreeRoot, canonicalWorktree);
      assert.equal(shared.gitCommonDir, join(canonicalRepo, '.git'));
      assert.equal(shared.worktreeScope, 'team');
      assert.equal(shared.requestedCodeGraphMode, 'auto');
      assert.equal(shared.codeGraphMode, 'shared');
      assert.equal(shared.codeGraphProjectPath, canonicalRepo);
      assert.equal(shared.codeGraphDbPath, join(canonicalRepo, '.codegraph', 'codegraph.db'));
      assert.match(renderCodeGraphInstructions(shared), /shared leader index/);

      const env = worktreeToolContextEnv(shared);
      assert.equal(env.OWX_REPO_ROOT, canonicalRepo);
      assert.equal(env.OWX_WORKTREE_ROOT, canonicalWorktree);
      assert.equal(env.OWX_GIT_COMMON_DIR, join(canonicalRepo, '.git'));
      assert.equal(env.OWX_CODEGRAPH_PROJECT_PATH, canonicalRepo);
      assert.equal(env.OWX_CODEGRAPH_REQUESTED_MODE, 'auto');
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('prefers a local database in auto mode and honors explicit off', async () => {
    const repo = await initRepo();
    const worktreePath = `${repo}-local-codegraph`;
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'local-codegraph', worktreePath, 'HEAD'], {
        cwd: repo,
        stdio: 'ignore',
      });
      await mkdir(join(repo, '.codegraph'), { recursive: true });
      await writeFile(join(repo, '.codegraph', 'codegraph.db'), 'shared', 'utf-8');
      await mkdir(join(worktreePath, '.codegraph'), { recursive: true });
      await writeFile(join(worktreePath, '.codegraph', 'codegraph.db'), 'local', 'utf-8');
      const canonicalWorktree = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();

      const local = resolveWorktreeToolContext({ cwd: worktreePath, scope: 'autoresearch', env: {} });
      assert.equal(local.codeGraphMode, 'local');
      assert.equal(local.codeGraphSource, 'worktree-local');
      assert.equal(local.codeGraphProjectPath, canonicalWorktree);
      assert.equal(local.codeGraphDbPath, join(canonicalWorktree, '.codegraph', 'codegraph.db'));

      const off = resolveWorktreeToolContext({
        cwd: worktreePath,
        scope: 'autoresearch',
        env: { OWX_CODEGRAPH_REQUESTED_MODE: 'off' },
      });
      assert.equal(off.codeGraphMode, 'off');
      assert.equal(off.codeGraphProjectPath, '');
      assert.equal(renderCodeGraphInstructions(off), '');
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('worktree ensure + rollback', () => {
  it('creates and reuses detached worktree idempotently', async () => {
    const repo = await initRepo();
    try {
      const planned = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: true, name: null },
      });
      assert.equal(planned.enabled, true);
      if (!planned.enabled) return;

      const created = ensureWorktree(planned);
      assert.equal(created.enabled, true);
      if (!created.enabled) return;
      assert.equal(created.created, true);
      assert.equal(existsSync(created.worktreePath), true);

      const reused = ensureWorktree(planned);
      assert.equal(reused.enabled, true);
      if (!reused.enabled) return;
      assert.equal(reused.reused, true);
      assert.equal(reused.created, false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('rejects reusing a dirty worktree', async () => {
    const repo = await initRepo();
    try {
      const planned = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: true, name: null },
      });
      assert.equal(planned.enabled, true);
      if (!planned.enabled) return;

      const created = ensureWorktree(planned);
      assert.equal(created.enabled, true);
      if (!created.enabled) return;

      await writeFile(join(created.worktreePath, 'DIRTY.txt'), 'dirty\n', 'utf-8');
      assert.throws(() => ensureWorktree(planned), /worktree_dirty/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('recreates a detached worktree when git worktree list still contains a missing stale path', async () => {
    const repo = await initRepo();
    try {
      const planned = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: true, name: null },
      });
      assert.equal(planned.enabled, true);
      if (!planned.enabled) return;

      const created = ensureWorktree(planned);
      assert.equal(created.enabled, true);
      if (!created.enabled) return;

      await rm(created.worktreePath, { recursive: true, force: true });
      assert.equal(existsSync(created.worktreePath), false);

      const recreated = ensureWorktree(planned);
      assert.equal(recreated.enabled, true);
      if (!recreated.enabled) return;
      assert.equal(recreated.created, true);
      assert.equal(recreated.reused, false);
      assert.equal(existsSync(recreated.worktreePath), true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('creates per-worker named branch and blocks branch-in-use collisions', async () => {
    const repo = await initRepo();
    try {
      const workerPlan = planWorktreeTarget({
        cwd: repo,
        scope: 'team',
        mode: { enabled: true, detached: false, name: 'feat' },
        teamName: 'alpha',
        workerName: 'worker-1',
      });
      assert.equal(workerPlan.enabled, true);
      if (!workerPlan.enabled) return;

      const created = ensureWorktree(workerPlan);
      assert.equal(created.enabled, true);
      if (!created.enabled) return;
      assert.equal(created.created, true);
      assert.equal(created.createdBranch, true);
      assert.equal(branchExists(repo, 'feat/worker-1'), true);

      const conflictingLaunchPlan = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: false, name: 'feat/worker-1' },
      });
      assert.equal(conflictingLaunchPlan.enabled, true);
      if (!conflictingLaunchPlan.enabled) return;

      assert.throws(() => ensureWorktree(conflictingLaunchPlan), /branch_in_use/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('reuses existing worktree when target path already exists as a valid alias', async () => {
    const repo = await initRepo();
    try {
      const plan = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: false, name: 'feature/reuse-alias' },
      });
      assert.equal(plan.enabled, true);
      if (!plan.enabled) return;

      const created = ensureWorktree(plan);
      assert.equal(created.enabled, true);
      if (!created.enabled) return;
      assert.equal(created.created, true);

      const aliasPath = `${created.worktreePath}-alias`;
      await symlink(created.worktreePath, aliasPath);

      const reused = ensureWorktree({ ...plan, worktreePath: aliasPath });
      assert.equal(reused.enabled, true);
      if (!reused.enabled) return;
      assert.equal(reused.reused, true);
      assert.equal(reused.created, false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('preserves mismatch safety when existing alias points to a different branch', async () => {
    const repo = await initRepo();
    try {
      const plan = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: false, name: 'feature/mismatch-source' },
      });
      assert.equal(plan.enabled, true);
      if (!plan.enabled) return;

      const created = ensureWorktree(plan);
      assert.equal(created.enabled, true);
      if (!created.enabled) return;
      assert.equal(created.created, true);

      const aliasPath = `${created.worktreePath}-alias`;
      await symlink(created.worktreePath, aliasPath);

      assert.throws(
        () => ensureWorktree({ ...plan, worktreePath: aliasPath, branchName: 'feature/other-branch' }),
        /worktree_target_mismatch/,
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('rollback removes newly created worktree and branch', async () => {
    const repo = await initRepo();
    try {
      const plan = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: false, name: 'feature/rollback' },
      });
      assert.equal(plan.enabled, true);
      if (!plan.enabled) return;

      const ensured = ensureWorktree(plan);
      assert.equal(ensured.enabled, true);
      if (!ensured.enabled) return;
      assert.equal(existsSync(ensured.worktreePath), true);
      assert.equal(branchExists(repo, 'feature/rollback'), true);

      await rollbackProvisionedWorktrees([ensured]);
      assert.equal(existsSync(ensured.worktreePath), false);
      assert.equal(branchExists(repo, 'feature/rollback'), false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('rollbackProvisionedWorktrees with skipBranchDeletion preserves branches', async () => {
    const repo = await initRepo();
    try {
      const plan = planWorktreeTarget({
        cwd: repo,
        scope: 'launch',
        mode: { enabled: true, detached: false, name: 'feature/ralph-keep' },
      });
      assert.equal(plan.enabled, true);
      if (!plan.enabled) return;

      const ensured = ensureWorktree(plan);
      assert.equal(ensured.enabled, true);
      if (!ensured.enabled) return;
      assert.equal(existsSync(ensured.worktreePath), true);
      assert.equal(branchExists(repo, 'feature/ralph-keep'), true);

      await rollbackProvisionedWorktrees([ensured], { skipBranchDeletion: true });
      assert.equal(existsSync(ensured.worktreePath), false);
      // Branch is preserved when skipBranchDeletion is true (ralph policy)
      assert.equal(branchExists(repo, 'feature/ralph-keep'), true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
