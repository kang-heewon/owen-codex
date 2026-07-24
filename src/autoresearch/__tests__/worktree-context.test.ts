import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  renderCodeGraphInstructions,
  resolveWorktreeToolContext,
} from '../worktree-context.js';

async function initRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'owx-autoresearch-context-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await writeFile(join(repo, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

describe('autoresearch worktree context', () => {
  it('fails closed outside a Git repository', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-autoresearch-context-non-git-'));
    try {
      assert.throws(
        () => resolveWorktreeToolContext({ cwd, env: {} }),
        /worktree_tool_context_git_root_unresolved/,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('derives linked-worktree identity and shared repository context from Git', async () => {
    const repo = await initRepo();
    const worktreePath = `${repo}-linked`;
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'linked', worktreePath, 'HEAD'], {
        cwd: repo,
        stdio: 'ignore',
      });
      await mkdir(join(repo, '.codegraph'), { recursive: true });
      await writeFile(join(repo, '.codegraph', 'codegraph.db'), 'shared');

      const context = resolveWorktreeToolContext({
        cwd: worktreePath,
        env: {
          OWX_REPO_ROOT: '/stale/repo',
          OWX_WORKTREE_ROOT: '/stale/worktree',
          OWX_CODEGRAPH_REQUESTED_MODE: 'invalid',
        },
      });

      assert.equal(await realpath(context.repoRoot), await realpath(repo));
      assert.equal(await realpath(context.worktreeRoot), await realpath(worktreePath));
      assert.equal(context.codeGraphMode, 'shared');
      assert.equal(context.codeGraphSource, 'repository-shared');
      assert.match(renderCodeGraphInstructions(context), /shared repository index/);
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('prefers a local database and honors explicit off', async () => {
    const repo = await initRepo();
    try {
      await mkdir(join(repo, '.codegraph'), { recursive: true });
      await writeFile(join(repo, '.codegraph', 'codegraph.db'), 'local');
      const local = resolveWorktreeToolContext({ cwd: repo, env: {} });
      assert.equal(local.codeGraphMode, 'local');
      assert.equal(local.codeGraphSource, 'worktree-local');

      const off = resolveWorktreeToolContext({
        cwd: repo,
        env: { OWX_CODEGRAPH_REQUESTED_MODE: 'off' },
      });
      assert.equal(off.codeGraphMode, 'off');
      assert.equal(renderCodeGraphInstructions(off), '');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
