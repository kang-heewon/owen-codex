import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve as resolvePath } from 'path';
import {
  getAllScopedStateDirs,
  getAllScopedStatePaths,
  getBaseStateDir,
  getAllSessionScopedStateDirs,
  getAllSessionScopedStatePaths,
  getReadScopedStateFilePaths,
  readCurrentSessionId,
  resolveRuntimeStateScope,
  resolveStateScope,
  resolveWorkingDirectoryForState,
  getStateDir,
  getStateFilePath,
  getStatePath,
  validateStateFileName,
  validateStateModeSegment,
  validateSessionId,
} from '../state-paths.js';


const isolatedEnvKeys = [
  'OWX_MCP_WORKDIR_ROOTS',
  'OWX_ROOT',
  'OWX_STATE_ROOT',
  'OWX_TEAM_STATE_ROOT',
  'OWX_SESSION_ID',
  'CODEX_SESSION_ID',
  'SESSION_ID',
] as const;
const originalEnv = Object.fromEntries(
  isolatedEnvKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof isolatedEnvKeys)[number], string | undefined>;

beforeEach(() => {
  for (const key of isolatedEnvKeys) delete process.env[key];
});

afterEach(() => {
  for (const key of isolatedEnvKeys) {
    const value = originalEnv[key];
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  }
});

async function mkRealTemp(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(join(await realpath(tmpdir()), prefix)));
}

describe('validateSessionId', () => {
  it('accepts undefined and valid ids', () => {
    assert.equal(validateSessionId(undefined), undefined);
    assert.equal(validateSessionId('abc_123-XYZ'), 'abc_123-XYZ');
  });

  it('rejects invalid ids', () => {
    assert.throws(() => validateSessionId(''), /session_id must match/);
    assert.throws(() => validateSessionId('bad/id'), /session_id must match/);
    assert.throws(() => validateSessionId(123), /session_id must be a string/);
  });
});

describe('validateStateModeSegment', () => {
  it('accepts safe mode names', () => {
    assert.equal(validateStateModeSegment('ralph'), 'ralph');
    assert.equal(validateStateModeSegment('ultraqa'), 'ultraqa');
  });

  it('rejects traversal and path separators', () => {
    assert.throws(() => validateStateModeSegment('../evil'), /must not contain "\.\."/);
    assert.throws(() => validateStateModeSegment('foo/bar'), /path separators/);
    assert.throws(() => validateStateModeSegment('foo\\bar'), /path separators/);
  });
});

describe('validateStateFileName', () => {
  it('accepts safe file names', () => {
    assert.equal(validateStateFileName('hud-state.json'), 'hud-state.json');
    assert.equal(validateStateFileName('session.json'), 'session.json');
  });

  it('rejects traversal and path separators', () => {
    assert.throws(() => validateStateFileName('../evil.json'), /must not contain "\.\."/);
    assert.throws(() => validateStateFileName('foo/bar.json'), /path separators/);
    assert.throws(() => validateStateFileName('foo\\bar.json'), /path separators/);
  });
});

describe('state paths', () => {
  it('uses explicit OWX_TEAM_STATE_ROOT before boxed roots and workingDirectory', () => {
    const prevRoot = process.env.OWX_ROOT;
    const prevStateRoot = process.env.OWX_STATE_ROOT;
    const prevTeamRoot = process.env.OWX_TEAM_STATE_ROOT;
    process.env.OWX_ROOT = '/tmp/owx-box';
    process.env.OWX_STATE_ROOT = '/tmp/ignored-state-root';
    process.env.OWX_TEAM_STATE_ROOT = '/tmp/explicit-team-state';
    try {
      assert.equal(getBaseStateDir('/tmp/source'), '/tmp/explicit-team-state');
      assert.equal(getStateDir('/tmp/source', 'sess1'), '/tmp/explicit-team-state/sessions/sess1');
      assert.equal(getStatePath('ralph', '/tmp/source', 'sess1'), '/tmp/explicit-team-state/sessions/sess1/ralph-state.json');
    } finally {
      if (typeof prevRoot === 'string') process.env.OWX_ROOT = prevRoot;
      else delete process.env.OWX_ROOT;
      if (typeof prevStateRoot === 'string') process.env.OWX_STATE_ROOT = prevStateRoot;
      else delete process.env.OWX_STATE_ROOT;
      if (typeof prevTeamRoot === 'string') process.env.OWX_TEAM_STATE_ROOT = prevTeamRoot;
      else delete process.env.OWX_TEAM_STATE_ROOT;
    }
  });

  it('uses OWX_ROOT as boxed workspace root before workingDirectory when no team root is explicit', () => {
    const prevRoot = process.env.OWX_ROOT;
    const prevStateRoot = process.env.OWX_STATE_ROOT;
    const prevTeamRoot = process.env.OWX_TEAM_STATE_ROOT;
    process.env.OWX_ROOT = '/tmp/owx-box';
    process.env.OWX_STATE_ROOT = '/tmp/ignored-state-root';
    delete process.env.OWX_TEAM_STATE_ROOT;
    try {
      assert.equal(getBaseStateDir('/tmp/source'), '/tmp/owx-box/.owx/state');
      assert.equal(getStateDir('/tmp/source', 'sess1'), '/tmp/owx-box/.owx/state/sessions/sess1');
      assert.equal(getStatePath('ralph', '/tmp/source', 'sess1'), '/tmp/owx-box/.owx/state/sessions/sess1/ralph-state.json');
    } finally {
      if (typeof prevRoot === 'string') process.env.OWX_ROOT = prevRoot;
      else delete process.env.OWX_ROOT;
      if (typeof prevStateRoot === 'string') process.env.OWX_STATE_ROOT = prevStateRoot;
      else delete process.env.OWX_STATE_ROOT;
      if (typeof prevTeamRoot === 'string') process.env.OWX_TEAM_STATE_ROOT = prevTeamRoot;
      else delete process.env.OWX_TEAM_STATE_ROOT;
    }
  });

  it('resolveWorkingDirectoryForState defaults to process.cwd()', () => {
    assert.equal(resolveWorkingDirectoryForState(undefined), process.cwd());
    assert.equal(resolveWorkingDirectoryForState(''), process.cwd());
    assert.equal(resolveWorkingDirectoryForState('   '), process.cwd());
  });

  it('resolveWorkingDirectoryForState normalizes Windows path on WSL/Linux when mount exists', () => {
    const raw = 'D:\\SIYUAN\\external\\repo';
    if (process.platform === 'win32') {
      assert.equal(resolveWorkingDirectoryForState(raw), resolvePath(raw));
      return;
    }
    if (existsSync('/mnt/d')) {
      assert.equal(resolveWorkingDirectoryForState(raw), '/mnt/d/SIYUAN/external/repo');
    } else {
      assert.throws(() => resolveWorkingDirectoryForState(raw), /not available on this host/);
    }
  });

  it('resolveWorkingDirectoryForState returns absolute normalized paths', () => {
    assert.equal(resolveWorkingDirectoryForState('.'), process.cwd());
  });

  it('rejects NUL bytes in workingDirectory', () => {
    assert.throws(() => resolveWorkingDirectoryForState('bad\0path'), /NUL byte/);
  });

  it('enforces OWX_MCP_WORKDIR_ROOTS allowlist when configured', async () => {
    const allowedRoot = await mkRealTemp('owx-allowed-root-');
    const disallowedRoot = await mkRealTemp('owx-disallowed-root-');
    const prev = process.env.OWX_MCP_WORKDIR_ROOTS;
    process.env.OWX_MCP_WORKDIR_ROOTS = allowedRoot;
    try {
      assert.equal(
        resolveWorkingDirectoryForState(join(allowedRoot, 'nested')),
        join(allowedRoot, 'nested'),
      );
      assert.throws(
        () => resolveWorkingDirectoryForState(disallowedRoot),
        /outside allowed roots \(OWX_MCP_WORKDIR_ROOTS\)/,
      );
    } finally {
      if (typeof prev === 'string') process.env.OWX_MCP_WORKDIR_ROOTS = prev;
      else delete process.env.OWX_MCP_WORKDIR_ROOTS;
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(disallowedRoot, { recursive: true, force: true });
    }
  });

  it('preserves symlinked workingDirectory spelling when no allowlist is configured', async () => {
    const realRoot = await mkRealTemp('owx-real-root-');
    const linkParent = await mkRealTemp('owx-link-parent-');
    const link = join(linkParent, 'workspace-link');
    const prev = process.env.OWX_MCP_WORKDIR_ROOTS;
    delete process.env.OWX_MCP_WORKDIR_ROOTS;
    try {
      await symlink(realRoot, link);

      assert.equal(resolveWorkingDirectoryForState(link), link);
    } finally {
      if (typeof prev === 'string') process.env.OWX_MCP_WORKDIR_ROOTS = prev;
      else delete process.env.OWX_MCP_WORKDIR_ROOTS;
      await rm(realRoot, { recursive: true, force: true });
      await rm(linkParent, { recursive: true, force: true });
    }
  });

  it('rejects symlinked workingDirectory candidates that escape OWX_MCP_WORKDIR_ROOTS', async () => {
    const allowedRoot = await mkRealTemp('owx-allowed-root-');
    const outsideRoot = await mkRealTemp('owx-outside-root-');
    const prev = process.env.OWX_MCP_WORKDIR_ROOTS;
    process.env.OWX_MCP_WORKDIR_ROOTS = allowedRoot;
    try {
      const link = join(allowedRoot, 'link');
      await symlink(outsideRoot, link);

      assert.throws(
        () => resolveWorkingDirectoryForState(link),
        /outside allowed roots \(OWX_MCP_WORKDIR_ROOTS\)/,
      );
    } finally {
      if (typeof prev === 'string') process.env.OWX_MCP_WORKDIR_ROOTS = prev;
      else delete process.env.OWX_MCP_WORKDIR_ROOTS;
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects symlinked OWX_MCP_WORKDIR_ROOTS entries instead of treating their targets as allowed roots', async () => {
    const intendedRoot = await mkRealTemp('owx-intended-root-');
    const outsideRoot = await mkRealTemp('owx-outside-root-');
    const prev = process.env.OWX_MCP_WORKDIR_ROOTS;
    const symlinkedRoot = join(intendedRoot, 'allowed-link');
    process.env.OWX_MCP_WORKDIR_ROOTS = symlinkedRoot;
    try {
      await symlink(outsideRoot, symlinkedRoot);

      assert.throws(
        () => resolveWorkingDirectoryForState(symlinkedRoot),
        /OWX_MCP_WORKDIR_ROOTS root .* resolves through a symlink/,
      );
    } finally {
      if (typeof prev === 'string') process.env.OWX_MCP_WORKDIR_ROOTS = prev;
      else delete process.env.OWX_MCP_WORKDIR_ROOTS;
      await rm(intendedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('builds global state paths', () => {
    const base = getBaseStateDir('/repo');
    assert.equal(base, '/repo/.owx/state');
    assert.equal(getStateDir('/repo'), '/repo/.owx/state');
    assert.equal(getStatePath('team', '/repo'), '/repo/.owx/state/team-state.json');
  });

  it('builds session state paths', () => {
    assert.equal(getStateDir('/repo', 'sess1'), '/repo/.owx/state/sessions/sess1');
    assert.equal(
      getStatePath('ralph', '/repo', 'sess1'),
      '/repo/.owx/state/sessions/sess1/ralph-state.json'
    );
    assert.equal(
      getStateFilePath('hud-state.json', '/repo', 'sess1'),
      '/repo/.owx/state/sessions/sess1/hud-state.json'
    );
  });

  it('throws when mode contains traversal tokens', () => {
    assert.throws(() => getStatePath('../../etc/passwd', '/repo'), /must not contain "\.\."/);
  });

  it('enumerates global-only path', async () => {
    const wd = await mkRealTemp('owx-state-paths-');
    try {
      const paths = await getAllScopedStatePaths('team', wd);
      assert.deepEqual(paths, [getStatePath('team', wd)]);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('enumerates session-scoped paths', async () => {
    const wd = await mkRealTemp('owx-state-paths-');
    try {
      const sessionsRoot = join(getBaseStateDir(wd), 'sessions');
      await mkdir(join(sessionsRoot, 'sess1'), { recursive: true });
      await mkdir(join(sessionsRoot, 'sess_2'), { recursive: true });

      const paths = await getAllSessionScopedStatePaths('team', wd);
      assert.deepEqual(paths.sort(), [
        getStatePath('team', wd, 'sess1'),
        getStatePath('team', wd, 'sess_2'),
      ].sort());
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('enumerates state directories across all scopes', async () => {
    const wd = await mkRealTemp('owx-state-paths-');
    try {
      const sessionsRoot = join(getBaseStateDir(wd), 'sessions');
      await mkdir(join(sessionsRoot, 'sess1'), { recursive: true });
      await mkdir(join(sessionsRoot, 'bad.name'), { recursive: true });

      const sessionDirs = await getAllSessionScopedStateDirs(wd);
      assert.deepEqual(sessionDirs, [join(sessionsRoot, 'sess1')]);

      const dirs = await getAllScopedStateDirs(wd);
      assert.deepEqual(dirs, [getBaseStateDir(wd), join(sessionsRoot, 'sess1')]);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('enumerates global and session-scoped paths together', async () => {
    const wd = await mkRealTemp('owx-state-paths-');
    try {
      const sessionsRoot = join(getBaseStateDir(wd), 'sessions');
      await mkdir(join(sessionsRoot, 'sess1'), { recursive: true });
      await mkdir(join(sessionsRoot, 'sess2'), { recursive: true });

      const paths = await getAllScopedStatePaths('ralph', wd);
      assert.deepEqual(paths.sort(), [
        getStatePath('ralph', wd),
        getStatePath('ralph', wd, 'sess1'),
        getStatePath('ralph', wd, 'sess2'),
      ].sort());
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('ignores invalid session directory names', async () => {
    const wd = await mkRealTemp('owx-state-paths-');
    try {
      const sessionsRoot = join(getBaseStateDir(wd), 'sessions');
      await mkdir(join(sessionsRoot, 'valid-session'), { recursive: true });
      await mkdir(join(sessionsRoot, 'bad.name'), { recursive: true });
      await mkdir(join(sessionsRoot, 'bad name'), { recursive: true });

      const paths = await getAllSessionScopedStatePaths('team', wd);
      assert.deepEqual(paths, [getStatePath('team', wd, 'valid-session')]);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('reads session-sensitive runtime files from the current session without root fallback when requested', async () => {
    const wd = await mkRealTemp('owx-state-paths-');
    try {
      const stateDir = getBaseStateDir(wd);
      await mkdir(join(stateDir, 'sessions', 'sess-current'), { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'session.json'), JSON.stringify({ session_id: 'sess-current' }));

      const paths = await getReadScopedStateFilePaths('hud-state.json', wd, undefined, {
        rootFallback: false,
      });
      assert.deepEqual(paths, [join(stateDir, 'sessions', 'sess-current', 'hud-state.json')]);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('prefers OWX_SESSION_ID over stale session.json when resolving current session id', async () => {
    const wd = await mkRealTemp('owx-state-paths-');
    const previousSessionId = process.env.OWX_SESSION_ID;
    try {
      const stateDir = getBaseStateDir(wd);
      await mkdir(stateDir, { recursive: true });
      await mkdir(join(stateDir, 'sessions', 'sess-env'), { recursive: true });
      await writeFile(join(stateDir, 'session.json'), JSON.stringify({
        session_id: 'sess-stale',
        cwd: join(wd, '..', 'other-worktree'),
      }));
      process.env.OWX_SESSION_ID = 'sess-env';

      assert.equal(await readCurrentSessionId(wd), 'sess-env');
    } finally {
      if (typeof previousSessionId === 'string') process.env.OWX_SESSION_ID = previousSessionId;
      else delete process.env.OWX_SESSION_ID;
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('maps native Codex session aliases to the canonical OWX session id', async () => {
    const wd = await mkRealTemp('owx-state-paths-native-alias-');
    const previousOmxSessionId = process.env.OWX_SESSION_ID;
    const previousCodexSessionId = process.env.CODEX_SESSION_ID;
    try {
      const stateDir = getBaseStateDir(wd);
      await mkdir(stateDir, { recursive: true });
      await mkdir(join(stateDir, 'sessions', 'owx-canonical'), { recursive: true });
      await writeFile(join(stateDir, 'session.json'), JSON.stringify({
        session_id: 'owx-canonical',
        native_session_id: 'codex-native',
        codex_session_id: 'codex-current',
        previous_native_session_id: 'codex-previous',
        cwd: wd,
      }));
      delete process.env.OWX_SESSION_ID;
      process.env.CODEX_SESSION_ID = 'codex-previous';

      assert.equal(await readCurrentSessionId(wd), 'owx-canonical');
      const scope = await resolveRuntimeStateScope(wd);
      assert.equal(scope.sessionId, 'owx-canonical');
      assert.equal(scope.source, 'native-alias');
    } finally {
      if (typeof previousOmxSessionId === 'string') process.env.OWX_SESSION_ID = previousOmxSessionId;
      else delete process.env.OWX_SESSION_ID;
      if (typeof previousCodexSessionId === 'string') process.env.CODEX_SESSION_ID = previousCodexSessionId;
      else delete process.env.CODEX_SESSION_ID;
      await rm(wd, { recursive: true, force: true });
    }
  });


  it('maps explicit native Codex session aliases through resolveStateScope', async () => {
    const wd = await mkRealTemp('owx-state-paths-explicit-native-alias-');
    try {
      const stateDir = getBaseStateDir(wd);
      await mkdir(stateDir, { recursive: true });
      await mkdir(join(stateDir, 'sessions', 'owx-canonical'), { recursive: true });
      await writeFile(join(stateDir, 'session.json'), JSON.stringify({
        session_id: 'owx-canonical',
        native_session_id: 'codex-native',
        previous_native_session_id: 'codex-previous',
        cwd: wd,
      }));

      const scope = await resolveStateScope(wd, 'codex-previous');
      assert.equal(scope.sessionId, 'owx-canonical');
      assert.equal(scope.stateDir, join(stateDir, 'sessions', 'owx-canonical'));
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('resolves OWX_SESSION_ID even before the session directory exists', async () => {
    const wd = await mkRealTemp('owx-state-paths-');
    const previousSessionId = process.env.OWX_SESSION_ID;
    try {
      await mkdir(getBaseStateDir(wd), { recursive: true });
      process.env.OWX_SESSION_ID = 'sess-not-yet-materialized';

      assert.equal(await readCurrentSessionId(wd), 'sess-not-yet-materialized');
    } finally {
      if (typeof previousSessionId === 'string') process.env.OWX_SESSION_ID = previousSessionId;
      else delete process.env.OWX_SESSION_ID;
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('resolves current session from authoritative team state root without OWX_SESSION_ID', async () => {
    const wd = await mkRealTemp('owx-state-paths-team-root-session-');
    const teamStateRoot = join(wd, 'team-state-root');
    const previousTeamStateRoot = process.env.OWX_TEAM_STATE_ROOT;
    const previousSessionId = process.env.OWX_SESSION_ID;
    try {
      process.env.OWX_TEAM_STATE_ROOT = teamStateRoot;
      delete process.env.OWX_SESSION_ID;
      await mkdir(join(teamStateRoot, 'sessions', 'sess-team-current'), { recursive: true });
      await writeFile(join(teamStateRoot, 'session.json'), JSON.stringify({
        session_id: 'sess-team-current',
        cwd: wd,
      }));
      await mkdir(join(wd, '.owx', 'state'), { recursive: true });
      await writeFile(join(wd, '.owx', 'state', 'session.json'), JSON.stringify({
        session_id: 'sess-stale-source-root',
        cwd: join(wd, '..', 'other-worktree'),
      }));

      assert.equal(await readCurrentSessionId(wd), 'sess-team-current');
    } finally {
      if (typeof previousTeamStateRoot === 'string') process.env.OWX_TEAM_STATE_ROOT = previousTeamStateRoot;
      else delete process.env.OWX_TEAM_STATE_ROOT;
      if (typeof previousSessionId === 'string') process.env.OWX_SESSION_ID = previousSessionId;
      else delete process.env.OWX_SESSION_ID;
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('does not resolve current session from source root when a team state root is authoritative', async () => {
    const wd = await mkRealTemp('owx-state-paths-ignore-source-session-');
    const teamStateRoot = join(wd, 'team-state-root');
    const previousTeamStateRoot = process.env.OWX_TEAM_STATE_ROOT;
    const previousSessionId = process.env.OWX_SESSION_ID;
    try {
      process.env.OWX_TEAM_STATE_ROOT = teamStateRoot;
      delete process.env.OWX_SESSION_ID;
      await mkdir(teamStateRoot, { recursive: true });
      const sourceStateDir = join(wd, '.owx', 'state');
      await mkdir(join(sourceStateDir, 'sessions', 'sess-source-current'), { recursive: true });
      await writeFile(join(sourceStateDir, 'session.json'), JSON.stringify({
        session_id: 'sess-source-current',
        cwd: wd,
      }));

      assert.equal(await readCurrentSessionId(wd), undefined);
    } finally {
      if (typeof previousTeamStateRoot === 'string') process.env.OWX_TEAM_STATE_ROOT = previousTeamStateRoot;
      else delete process.env.OWX_TEAM_STATE_ROOT;
      if (typeof previousSessionId === 'string') process.env.OWX_SESSION_ID = previousSessionId;
      else delete process.env.OWX_SESSION_ID;
      await rm(wd, { recursive: true, force: true });
    }
  });
});
