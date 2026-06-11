import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  nestedRepoLocalApiBinaryPath,
  packagedApiBinaryCandidatePaths,
  repoLocalApiBinaryPath,
  resolveApiBinaryPath,
  resolveApiBinaryPathWithHydration,
  runApiBinary,
} from '../api.js';

function runOmx(
  cwd: string,
  argv: string[],
  envOverrides: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string; error?: string } {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(testDir, '..', '..', '..');
  const owxBin = join(repoRoot, 'dist', 'cli', 'owx.js');
  const result = spawnSync('node', [owxBin, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...envOverrides },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message,
  };
}

function shouldSkipForSpawnPermissions(err?: string): boolean {
  return typeof err === 'string' && /(EPERM|EACCES)/i.test(err);
}

describe('resolveApiBinaryPath', () => {
  it('prefers OWX_API_BIN override', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-api-override-'));
    try {
      assert.equal(
        resolveApiBinaryPath({
          cwd,
          env: { OWX_API_BIN: './bin/custom-api' },
          packageRoot: '/unused',
        }),
        join(cwd, 'bin', 'custom-api'),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('checks Linux musl packaged paths before glibc and legacy paths', () => {
    assert.deepEqual(
      packagedApiBinaryCandidatePaths('/repo', 'linux', 'x64', {}, ['musl', 'glibc']),
      [
        '/repo/bin/native/linux-x64-musl/owx-api',
        '/repo/bin/native/linux-x64-glibc/owx-api',
        '/repo/bin/native/linux-x64/owx-api',
      ],
    );
  });

  it('falls back from packaged binary to repo-local build artifact', () => {
    const packageRoot = '/repo';
    const repoLocal = repoLocalApiBinaryPath(packageRoot);
    assert.equal(
      resolveApiBinaryPath({ packageRoot, exists: (path) => path === repoLocal }),
      repoLocal,
    );
  });

  it('falls back to nested repo-local native build artifact when present', () => {
    const packageRoot = '/repo';
    const nestedRepoLocal = nestedRepoLocalApiBinaryPath(packageRoot);
    assert.equal(
      resolveApiBinaryPath({ packageRoot, exists: (path) => path === nestedRepoLocal }),
      nestedRepoLocal,
    );
  });

  it('throws with checked paths when neither packaged nor repo-local binary exists', () => {
    assert.throws(
      () => resolveApiBinaryPath({ packageRoot: '/repo', exists: () => false }),
      /native binary not found/,
    );
  });


  it('prefers a cached hydrated owx-api binary before packaged and repo-local paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-api-cached-'));
    try {
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ version: '0.8.15' }));
      const cacheDir = join(cwd, 'cache');
      const cachedDir = join(cacheDir, '0.8.15', 'linux-x64-musl', 'owx-api');
      const cachedBinary = join(cachedDir, 'owx-api');
      await mkdir(cachedDir, { recursive: true });
      await writeFile(cachedBinary, '#!/bin/sh\n');
      await chmod(cachedBinary, 0o755);

      assert.equal(
        await resolveApiBinaryPathWithHydration({
          packageRoot: cwd,
          platform: 'linux',
          arch: 'x64',
          linuxLibcPreference: ['musl', 'glibc'],
          env: { OWX_NATIVE_CACHE_DIR: cacheDir, OWX_NATIVE_AUTO_FETCH: '0' },
        }),
        cachedBinary,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('runApiBinary', () => {
  it('forwards argv, cwd, and env to the native binary', () => {
    const calls: { binary: string; args: string[]; options: unknown }[] = [];
    const result = runApiBinary('/fake/owx-api', ['generate', 'text', 'hello'], {
      cwd: '/work',
      env: { TEST_ENV: '1' },
      spawnImpl: ((binary: string, args: string[], options: unknown) => {
        calls.push({ binary, args, options });
        return { status: 0, signal: null, output: [], stdout: 'ok\n', stderr: '', pid: 123 };
      }) as unknown as typeof spawnSync,
    });

    assert.equal(result.stdout, 'ok\n');
    assert.equal(calls[0]?.binary, '/fake/owx-api');
    assert.deepEqual(calls[0]?.args, ['generate', 'text', 'hello']);
    assert.deepEqual(calls[0]?.options, {
      cwd: '/work',
      env: { TEST_ENV: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
  });
});

describe('owx api', () => {
  it('includes api in top-level help output', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-api-help-'));
    try {
      const result = runOmx(cwd, ['--help']);
      if (shouldSkipForSpawnPermissions(result.error)) return;

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /owx api\s+Run native owx-api localhost gateway commands \(serve\|status\|stop\|generate\)/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('prints api usage when invoked with top-level or nested --help', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-api-subhelp-'));
    try {
      for (const argv of [['api', '--help'], ['api', 'serve', '--help'], ['api', 'generate', '--help']]) {
        const result = runOmx(cwd, argv);
        if (shouldSkipForSpawnPermissions(result.error)) return;

        assert.equal(result.status, 0, `${argv.join(' ')} stderr=${result.stderr} stdout=${result.stdout}`);
        assert.match(result.stdout, /Usage: owx api <command> \[args\.\.\.\]/);
        assert.match(result.stdout, /generate text <prompt\.\.\.>/);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('preserves child stdout, stderr, and exit code through the JS bridge', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-api-bridge-'));
    try {
      const binDir = join(cwd, 'bin');
      const stubPath = join(binDir, process.platform === 'win32' ? 'owx-api.cmd' : 'owx-api');
      await mkdir(binDir, { recursive: true });
      if (process.platform === 'win32') {
        await writeFile(stubPath, '@echo off\r\necho api-stdout\r\n>&2 echo api-stderr\r\nexit /b 7\r\n');
      } else {
        await writeFile(stubPath, '#!/bin/sh\necho api-stdout\necho api-stderr 1>&2\nexit 7\n');
        await chmod(stubPath, 0o755);
      }

      const result = runOmx(cwd, ['api', 'generate', 'text', 'hello'], { OWX_API_BIN: stubPath });
      if (shouldSkipForSpawnPermissions(result.error)) return;

      assert.equal(result.status, 7, result.stderr || result.stdout);
      assert.equal(result.stdout, 'api-stdout\n');
      assert.equal(result.stderr, 'api-stderr\n');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('fails clearly when the configured native binary path does not exist', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'owx-api-missing-'));
    try {
      const result = runOmx(cwd, ['api', 'status'], { OWX_API_BIN: join(cwd, 'bin', 'missing-api') });
      if (shouldSkipForSpawnPermissions(result.error)) return;

      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /failed to launch native binary: executable not found/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
