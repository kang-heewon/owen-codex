import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, '..', '..', '..');
const owxBin = join(repoRoot, 'dist', 'cli', 'owx.js');

describe('direct Codex launch', () => {
  it('runs exactly one child in the foreground and propagates its exit status', async () => {
    if (process.platform === 'win32') return;

    const cwd = await mkdtemp(join(tmpdir(), 'owx-direct-launch-'));
    try {
      const home = join(cwd, 'home');
      const bin = join(cwd, 'bin');
      const invocationLog = join(cwd, 'invocations.log');
      const notifyContractLog = join(cwd, 'notify-contract.log');
      const owxRootLog = join(cwd, 'owx-root.log');
      const completionMarker = join(cwd, 'child-complete');
      await mkdir(home, { recursive: true });
      await mkdir(bin, { recursive: true });
      await writeFile(
        join(bin, 'codex'),
        [
          '#!/bin/sh',
          `printf '%s|%s|%s\\n' "$$" "$PWD" "$*" >> ${JSON.stringify(invocationLog)}`,
          `printf '%s\\n' "$OWX_NOTIFY_TEMP_CONTRACT" > ${JSON.stringify(notifyContractLog)}`,
          `printf '%s\\n' "$OWX_ROOT" > ${JSON.stringify(owxRootLog)}`,
          'sleep 0.2',
          `printf 'complete\\n' > ${JSON.stringify(completionMarker)}`,
          'exit 23',
          '',
        ].join('\n'),
      );
      await chmod(join(bin, 'codex'), 0o755);

      const startedAt = Date.now();
      const result = spawnSync(process.execPath, [owxBin, '--notify-temp', '--discord', '--model', 'test-model'], {
        cwd,
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}:/usr/bin:/bin`,
          OWX_AUTO_UPDATE: '0',
          OWX_HOOK_DERIVED_SIGNALS: '0',
          OWX_ROOT: '',
        },
      });
      const elapsedMs = Date.now() - startedAt;
      const canonicalCwd = await realpath(cwd);

      assert.equal(result.status, 23, result.stderr || result.stdout);
      assert.ok(elapsedMs >= 150, `launcher returned before its child completed (${elapsedMs}ms)`);
      assert.equal(existsSync(completionMarker), true);
      const invocations = (await readFile(invocationLog, 'utf-8')).trim().split('\n');
      assert.equal(invocations.length, 1);
      assert.match(invocations[0] ?? '', new RegExp(`\\|${canonicalCwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`));
      assert.match(invocations[0] ?? '', /--model test-model/);
      assert.doesNotMatch(invocations[0] ?? '', /--notify-temp|--discord/);
      const notifyContract = JSON.parse(await readFile(notifyContractLog, 'utf-8')) as {
        active: boolean;
        canonicalSelectors: string[];
      };
      assert.equal(notifyContract.active, true);
      assert.deepEqual(notifyContract.canonicalSelectors, ['discord']);
      assert.equal((await readFile(owxRootLog, 'utf-8')).trim(), '');
      assert.equal(existsSync(join(cwd, '.owx', '.owx')), false);
      assert.equal(existsSync(join(cwd, '.owx', 'state', 'session.json')), false);
      assert.equal(existsSync(join(cwd, '.owx', 'state', 'hud-state.json')), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('preserves an explicit project-root override without appending another .owx segment', async () => {
    if (process.platform === 'win32') return;

    const cwd = await mkdtemp(join(tmpdir(), 'owx-direct-root-'));
    try {
      const home = join(cwd, 'home');
      const bin = join(cwd, 'bin');
      const explicitRoot = join(cwd, 'state-project');
      const owxRootLog = join(cwd, 'owx-root.log');
      const pluginHook = join(repoRoot, 'plugins', 'owen-codex', 'hooks', 'codex-native-hook.mjs');
      await mkdir(home, { recursive: true });
      await mkdir(bin, { recursive: true });
      await mkdir(explicitRoot, { recursive: true });
      await writeFile(
        join(bin, 'codex'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$OWX_ROOT" > ${JSON.stringify(owxRootLog)}`,
          `printf '%s' ${JSON.stringify(JSON.stringify({
            hook_event_name: 'SessionStart',
            session_id: 'sess-direct-explicit-root',
            cwd,
          }))} | ${JSON.stringify(process.execPath)} ${JSON.stringify(pluginHook)} >/dev/null`,
          'exit 0',
          '',
        ].join('\n'),
      );
      await chmod(join(bin, 'codex'), 0o755);

      const result = spawnSync(process.execPath, [owxBin], {
        cwd,
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}:/usr/bin:/bin`,
          OWX_AUTO_UPDATE: '0',
          OWX_HOOK_DERIVED_SIGNALS: '0',
          OWX_ROOT: explicitRoot,
        },
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal((await readFile(owxRootLog, 'utf-8')).trim(), explicitRoot);
      assert.equal(existsSync(join(explicitRoot, '.owx', 'state', 'session.json')), true);
      assert.equal(existsSync(join(explicitRoot, '.owx', '.owx')), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('lets hooks use the launch cwd as the default project root', async () => {
    if (process.platform === 'win32') return;

    const cwd = await mkdtemp(join(tmpdir(), 'owx-direct-hook-root-'));
    try {
      const home = join(cwd, 'home');
      const bin = join(cwd, 'bin');
      const pluginHook = join(repoRoot, 'plugins', 'owen-codex', 'hooks', 'codex-native-hook.mjs');
      await mkdir(home, { recursive: true });
      await mkdir(bin, { recursive: true });
      await writeFile(
        join(bin, 'codex'),
        [
          '#!/bin/sh',
          `printf '%s' ${JSON.stringify(JSON.stringify({
            hook_event_name: 'SessionStart',
            session_id: 'sess-direct-default-root',
            cwd,
          }))} | ${JSON.stringify(process.execPath)} ${JSON.stringify(pluginHook)} >/dev/null`,
          'exit 0',
          '',
        ].join('\n'),
      );
      await chmod(join(bin, 'codex'), 0o755);

      const result = spawnSync(process.execPath, [owxBin], {
        cwd,
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: home,
          CODEX_HOME: home,
          PATH: `${bin}:/usr/bin:/bin`,
          OWX_AUTO_UPDATE: '0',
          OWX_HOOK_DERIVED_SIGNALS: '0',
          OWX_ROOT: '',
        },
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(existsSync(join(cwd, '.owx', 'state', 'session.json')), true);
      assert.equal(existsSync(join(cwd, '.owx', '.owx')), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
