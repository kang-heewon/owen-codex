import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

export type RequestedCodeGraphMode = 'auto' | 'shared' | 'local' | 'off';
export type ResolvedCodeGraphMode = Exclude<RequestedCodeGraphMode, 'auto'>;

export interface WorktreeToolContext {
  repoRoot: string;
  worktreeRoot: string;
  gitCommonDir: string;
  codeGraphMode: ResolvedCodeGraphMode;
  codeGraphProjectPath: string;
  codeGraphDbPath: string;
  codeGraphSource: 'worktree-local' | 'repository-shared' | 'none';
  requestedCodeGraphMode: RequestedCodeGraphMode;
}

export interface ResolveWorktreeToolContextOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

function tryReadGit(cwd: string, args: string[]): string | null {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const value = (result.stdout || '').trim();
  return value || null;
}

function resolveGitCommonDir(cwd: string): string {
  const absolute = tryReadGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (absolute) return resolve(absolute);
  const raw = tryReadGit(cwd, ['rev-parse', '--git-common-dir']);
  if (raw) return resolve(cwd, raw);
  throw new Error(`worktree_tool_context_git_common_dir_unresolved:${resolve(cwd)}`);
}

function resolveRepositoryRoot(worktreeRoot: string, gitCommonDir: string): string {
  if (basename(gitCommonDir) === '.git') return dirname(gitCommonDir);
  const listing = tryReadGit(worktreeRoot, ['worktree', 'list', '--porcelain']);
  const primaryWorktree = listing
    ?.split(/\r?\n/)
    .find((line) => line.startsWith('worktree '))
    ?.slice('worktree '.length)
    .trim();
  if (primaryWorktree) return resolve(primaryWorktree);
  throw new Error(`worktree_tool_context_repo_root_unresolved:${worktreeRoot}`);
}

function normalizeRequestedCodeGraphMode(env: NodeJS.ProcessEnv): RequestedCodeGraphMode {
  const raw = String(env.OWX_CODEGRAPH_REQUESTED_MODE ?? env.OWX_CODEGRAPH_MODE ?? 'auto')
    .trim()
    .toLowerCase();
  return raw === 'shared' || raw === 'local' || raw === 'off' ? raw : 'auto';
}

export function resolveWorktreeToolContext(
  options: ResolveWorktreeToolContextOptions,
): WorktreeToolContext {
  const gitRoot = tryReadGit(options.cwd, ['rev-parse', '--show-toplevel']);
  if (!gitRoot) {
    throw new Error(`worktree_tool_context_git_root_unresolved:${resolve(options.cwd)}`);
  }
  const worktreeRoot = resolve(gitRoot);
  const gitCommonDir = resolveGitCommonDir(options.cwd);
  const repoRoot = resolveRepositoryRoot(worktreeRoot, gitCommonDir);
  const requestedCodeGraphMode = normalizeRequestedCodeGraphMode(options.env ?? process.env);
  const localDbPath = join(worktreeRoot, '.codegraph', 'codegraph.db');
  const sharedDbPath = join(repoRoot, '.codegraph', 'codegraph.db');
  const hasLocalDb = existsSync(localDbPath);
  const hasSharedDb = existsSync(sharedDbPath);

  let codeGraphMode: ResolvedCodeGraphMode = 'off';
  let codeGraphProjectPath = '';
  let codeGraphDbPath = '';
  let codeGraphSource: WorktreeToolContext['codeGraphSource'] = 'none';

  if (requestedCodeGraphMode === 'local' || (requestedCodeGraphMode === 'auto' && hasLocalDb)) {
    codeGraphMode = 'local';
    codeGraphProjectPath = worktreeRoot;
    codeGraphDbPath = localDbPath;
    codeGraphSource = 'worktree-local';
  } else if (requestedCodeGraphMode === 'shared' || (requestedCodeGraphMode === 'auto' && hasSharedDb)) {
    codeGraphMode = 'shared';
    codeGraphProjectPath = repoRoot;
    codeGraphDbPath = sharedDbPath;
    codeGraphSource = 'repository-shared';
  }

  return {
    repoRoot,
    worktreeRoot,
    gitCommonDir,
    codeGraphMode,
    codeGraphProjectPath,
    codeGraphDbPath,
    codeGraphSource,
    requestedCodeGraphMode,
  };
}

export function renderCodeGraphInstructions(context: WorktreeToolContext): string {
  if (context.codeGraphMode === 'off') return '';
  const modeLine = context.codeGraphMode === 'local'
    ? `- Mode: local worktree index (${context.codeGraphProjectPath})`
    : `- Mode: shared repository index (${context.codeGraphProjectPath})`;
  const warning = context.codeGraphMode === 'shared'
    ? '- Warning: the shared repository CodeGraph index is not branch-accurate for worktree-only changes; verify changed files directly in this worktree.'
    : '';
  return [
    '## CodeGraph',
    modeLine,
    `- Project path: ${context.codeGraphProjectPath}`,
    `- Database: ${context.codeGraphDbPath || '(not found yet)'}`,
    '- OWX does not install CodeGraph, auto-index worktrees, or copy/symlink `.codegraph` for this run.',
    warning,
  ].filter(Boolean).join('\n');
}
