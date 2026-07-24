import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import { buildMergedConfig } from '../../config/generator.js';
import type { CatalogManifest } from '../../catalog/schema.js';
import { getSetupInstallableSkillNames } from '../../catalog/installable.js';
import {
  buildOmxPluginMcpManifest,
  OWX_FIRST_PARTY_MCP_ENTRYPOINTS,
  OWX_FIRST_PARTY_MCP_PLUGIN_TARGETS,
  OWX_FIRST_PARTY_MCP_SERVER_NAMES,
  OWX_PLUGIN_MCP_COMMAND,
  OWX_PLUGIN_MCP_SERVE_SUBCOMMAND,
} from '../../config/owx-first-party-mcp.js';

type PackageJson = {
  version: string;
};


type PluginManifest = {
  name?: string;
  version?: string;
  skills?: string;
  agents?: string;
  prompts?: string;
  hooks?: string;
  mcpServers?: string;
  apps?: string;
  interface?: {
    displayName?: string;
    shortDescription?: string;
    longDescription?: string;
    developerName?: string;
    category?: string;
  };
};

type Marketplace = {
  name?: string;
  interface?: { displayName?: string };
  plugins?: Array<{
    name?: string;
    source?: { source?: string; path?: string };
    policy?: { installation?: string; authentication?: string };
    category?: string;
  }>;
};

const root = process.cwd();
const pluginName = 'owen-codex';
const pluginRoot = join(root, 'plugins', pluginName);
const pluginManifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
const pluginMcpPath = join(pluginRoot, '.mcp.json');
const pluginAppsPath = join(pluginRoot, '.app.json');
const pluginHooksPath = join(pluginRoot, 'hooks', 'hooks.json');
const pluginHookLauncherPath = join(pluginRoot, 'hooks', 'codex-native-hook.mjs');
const marketplacePath = join(root, '.agents', 'plugins', 'marketplace.json');
const owxBin = join(root, 'dist', 'cli', 'owx.js');

type PluginMcpManifest = {
  mcpServers?: Record<string, {
    command?: string;
    args?: string[];
    enabled?: boolean;
  }>;
};

type PluginAppsManifest = {
  apps?: Record<string, unknown>;
};

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf-8');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, base);
    if (entry.isFile()) return [relative(base, fullPath).split(sep).join('/')];
    return [];
  }));
  return files.flat().sort();
}

async function writeOmxShim(binDir: string): Promise<void> {
  await mkdir(binDir, { recursive: true });

  if (process.platform === 'win32') {
    await writeFile(
      join(binDir, 'owx.cmd'),
      `@echo off\r\n"${process.execPath}" "${owxBin}" %*\r\n`,
      'utf-8',
    );
    return;
  }

  const shimPath = join(binDir, 'owx');
  await writeFile(
    shimPath,
    `#!/bin/sh\nexec "${process.execPath}" "${owxBin}" "$@"\n`,
    'utf-8',
  );
  await chmod(shimPath, 0o755);
}

async function createPluginMirrorFixtureRoot(): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'owx-plugin-mirror-fixture-'));
  await Promise.all([
    mkdir(join(fixtureRoot, 'plugins'), { recursive: true }),
    mkdir(join(fixtureRoot, 'src', 'catalog'), { recursive: true }),
  ]);
  await Promise.all([
    cp(join(root, 'package.json'), join(fixtureRoot, 'package.json')),
    cp(join(root, 'plugins', pluginName), join(fixtureRoot, 'plugins', pluginName), { recursive: true }),
    cp(join(root, 'skills'), join(fixtureRoot, 'skills'), { recursive: true }),
    cp(join(root, 'src', 'catalog', 'manifest.json'), join(fixtureRoot, 'src', 'catalog', 'manifest.json')),
  ]);
  return fixtureRoot;
}

async function assertSyncPluginRepairsMissingHooksPointer(): Promise<void> {
  const fixtureRoot = await createPluginMirrorFixtureRoot();
  try {
    const fixtureManifestPath = join(fixtureRoot, 'plugins', pluginName, '.codex-plugin', 'plugin.json');
    const fixtureHooksPath = join(fixtureRoot, 'plugins', pluginName, 'hooks', 'hooks.json');
    const originalManifest = await readFile(fixtureManifestPath, 'utf-8');
    const manifest = JSON.parse(originalManifest) as PluginManifest;
    delete manifest.hooks;
    await writeFile(fixtureManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

    const result = spawnSync(process.execPath, [join(root, 'dist', 'scripts', 'sync-plugin-mirror.js')], {
      cwd: fixtureRoot,
      encoding: 'utf-8',
      env: {
        ...process.env,
        OWX_AUTO_UPDATE: '0',
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const repairedManifest = await readJson<PluginManifest>(fixtureManifestPath);
    assert.equal(repairedManifest.hooks, './hooks/hooks.json');

    const hooksManifest = await readJson<{ hooks?: Record<string, Array<{ matcher?: string }>> }>(fixtureHooksPath);
    const preToolUseEntries = hooksManifest.hooks?.PreToolUse ?? [];
    assert.notEqual(preToolUseEntries.length, 0, 'fixture sync should keep PreToolUse hook entries');
    assert.deepEqual(
      preToolUseEntries.map((entry) => entry.matcher).filter((matcher): matcher is string => typeof matcher === 'string'),
      [],
      'fixture sync must not reintroduce a Bash-only PreToolUse matcher',
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function assertSyncPluginCheckRejectsLauncherWithoutContract(): Promise<void> {
  const fixtureRoot = await createPluginMirrorFixtureRoot();
  try {
    const fixtureHookLauncherPath = join(fixtureRoot, 'plugins', pluginName, 'hooks', 'codex-native-hook.mjs');
    const launcher = await readFile(fixtureHookLauncherPath, 'utf-8');
    await writeFile(
      fixtureHookLauncherPath,
      launcher.replace('owx-plugin-hook-standalone:v1', 'owx-plugin-hook-standalone:missing'),
      'utf-8',
    );

    const result = spawnSync(process.execPath, [join(root, 'dist', 'scripts', 'sync-plugin-mirror.js'), '--check'], {
      cwd: fixtureRoot,
      encoding: 'utf-8',
      env: {
        ...process.env,
        OWX_AUTO_UPDATE: '0',
      },
    });

    assert.notEqual(result.status, 0, 'sync-plugin-mirror --check should reject launcher contract drift');
    assert.match(result.stderr, /plugin_bundle_metadata_out_of_sync/);
    assert.match(result.stderr, /kind=hook-launcher/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function assertPluginHookEventsAlignWithLauncher(): Promise<void> {
  const hooksManifest = await readJson<{ hooks?: Record<string, unknown> }>(pluginHooksPath);
  const launcher = await readFile(pluginHookLauncherPath, 'utf-8');
  const eventSetMatch = launcher.match(/const CODEX_HOOK_EVENT_NAMES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(eventSetMatch, 'plugin hook launcher should declare a CODEX_HOOK_EVENT_NAMES set');
  const launcherEvents = Array.from(eventSetMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]).sort();
  assert.deepEqual(
    launcherEvents,
    Object.keys(hooksManifest.hooks ?? {}).sort(),
    'plugin hook launcher event allowlist must stay aligned with generated plugin hooks manifest',
  );
}

async function assertPluginHookLaunchesPostCompactFromCache(): Promise<void> {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'owx-plugin-hook-cache-'));
  const cachePluginRoot = join(cacheRoot, pluginName, 'local');
  const emptyBinDir = join(cacheRoot, 'empty-bin');
  await cp(pluginRoot, cachePluginRoot, { recursive: true });
  await mkdir(emptyBinDir, { recursive: true });

  try {
    const payload = JSON.stringify({
      hook_event_name: 'PostCompact',
      session_id: 'owx-plugin-hook-postcompact-smoke',
      transcript_path: join(cacheRoot, 'missing-transcript.jsonl'),
      cwd: cacheRoot,
    });
    const result = spawnSync(process.execPath, [join(cachePluginRoot, 'hooks', 'codex-native-hook.mjs')], {
      cwd: cachePluginRoot,
      encoding: 'utf-8',
      input: payload,
      env: {
        ...process.env,
        PATH: emptyBinDir,
        OWX_AUTO_UPDATE: '0',
        OWX_HOOK_DERIVED_SIGNALS: '0',
        OWX_ROOT: join(cacheRoot, '.owx-root'),
        OWX_SESSION_ID: 'owx-plugin-hook-postcompact-smoke',
        OWX_SOURCE_CWD: cacheRoot,
        OWX_STARTUP_CWD: cacheRoot,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout, '', 'PostCompact plugin hook should emit no stdout');
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|Cannot find module/);
    await assert.rejects(stat(join(cachePluginRoot, 'hooks', 'owx-command.json')));
    await assert.rejects(stat(join(cacheRoot, 'dist', 'cli', 'owx.js')));
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
}

async function assertPluginCacheLaunchable(entrypoint: string): Promise<void> {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'owx-plugin-cache-'));
  const cachePluginRoot = join(cacheRoot, pluginName, 'local');
  const shimDir = join(cacheRoot, 'bin');
  await cp(pluginRoot, cachePluginRoot, { recursive: true });
  await writeOmxShim(shimDir);

  try {
    const result = spawnSync(OWX_PLUGIN_MCP_COMMAND, [OWX_PLUGIN_MCP_SERVE_SUBCOMMAND, entrypoint], {
      cwd: cachePluginRoot,
      encoding: 'utf-8',
      input: '',
      env: {
        ...process.env,
        PATH: `${shimDir}${delimiter}${process.env.PATH || ''}`,
        OWX_AUTO_UPDATE: '0',
        OWX_HOOK_DERIVED_SIGNALS: '0',
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr.trim(), '', `${entrypoint} should not fail when launched from a cache-style plugin root`);
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
}

function parseSingleJsonStdout(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  assert.notEqual(trimmed, '');
  assert.equal(trimmed.split('\n').length, 1);
  return JSON.parse(trimmed) as Record<string, unknown>;
}

async function withPluginCacheCopy<T>(run: (cachePluginRoot: string, cacheRoot: string) => Promise<T>): Promise<T> {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'owx-plugin-hook-cache-'));
  const cachePluginRoot = join(cacheRoot, pluginName, 'local');
  await cp(pluginRoot, cachePluginRoot, { recursive: true });
  try {
    return await run(cachePluginRoot, cacheRoot);
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
}

function pluginHookEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    'OWX_TE\x41M_STATE_ROOT',
    'OWX_ROOT',
    'OWX_STATE_ROOT',
    'OWX_SESSION_ID',
    'CODEX_SESSION_ID',
    'OWX_NOTIFY_TEMP_CONTRACT',
    'OWX_NOTIFY_PROFILE',
    'OWX_DISCORD_WEBHOOK_URL',
    'OWX_DISCORD_NOTIFIER_BOT_TOKEN',
    'OWX_DISCORD_NOTIFIER_CHANNEL',
    'OWX_TELEGRAM_BOT_TOKEN',
    'OWX_TELEGRAM_CHAT_ID',
    'OWX_SLACK_WEBHOOK_URL',
  ]) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function runPluginNativeHook(
  cachePluginRoot: string,
  input: string,
  env: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, [join(cachePluginRoot, 'hooks', 'codex-native-hook.mjs')], {
    cwd: cachePluginRoot,
    input,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: pluginHookEnv({ CODEX_HOME: join(cachePluginRoot, '.codex-test'), ...env }),
  });
}

describe('official Codex plugin layout', () => {
  it('defines a plugin manifest under a plugin root and keeps .codex-plugin limited to plugin.json', async () => {
    const pkg = await readJson<PackageJson>(join(root, 'package.json'));
    const manifest = await readJson<PluginManifest>(pluginManifestPath);
    const codexPluginEntries = await readdir(join(pluginRoot, '.codex-plugin'));

    assert.deepEqual(codexPluginEntries.sort(), ['plugin.json']);
    assert.equal(manifest.name, pluginName);
    assert.equal(manifest.name, pluginRoot.split(sep).at(-1));
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.skills, './skills/');
    assert.equal(manifest.mcpServers, './.mcp.json');
    assert.equal(manifest.apps, './.app.json');
    assert.equal(manifest.interface?.displayName, 'owen-codex');
    assert.equal(manifest.interface?.category, 'Developer Tools');
    assert.ok(manifest.interface?.shortDescription, 'expected short interface description');
    assert.ok(manifest.interface?.longDescription, 'expected long interface description');
    assert.ok(manifest.interface?.developerName, 'expected developerName');
  });

  it('repairs a missing plugin hooks manifest pointer during plugin sync', async () => {
    await assertSyncPluginRepairsMissingHooksPointer();
  });

  it('rejects plugin hook launcher drift during plugin sync check', async () => {
    await assertSyncPluginCheckRejectsLauncherWithoutContract();
  });

  it('keeps generated plugin hook events aligned with the launcher allowlist', async () => {
    await assertPluginHookEventsAlignWithLauncher();
  });

  it('ships plugin-scoped hooks and disabled-by-default MCP compatibility metadata', async () => {
    const [mcpManifest, appsManifest, hooksManifest] = await Promise.all([
      readJson<PluginMcpManifest>(pluginMcpPath),
      readJson<PluginAppsManifest>(pluginAppsPath),
      readJson<{ hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>> }>(pluginHooksPath),
    ]);
    const expectedPluginMcpManifest = buildOmxPluginMcpManifest();

    const pluginManifest = await readJson<PluginManifest>(pluginManifestPath);
    assert.equal(pluginManifest.agents, undefined);
    assert.equal(pluginManifest.prompts, undefined);
    assert.equal(pluginManifest.hooks, './hooks/hooks.json');
    assert.deepEqual(appsManifest, { apps: {} });
    const hookCommands = Object.values(hooksManifest.hooks ?? {})
      .flatMap((entries) => entries)
      .flatMap((entry) => entry.hooks ?? [])
      .map((hook) => hook.command);
    assert.ok(
      hookCommands.every((command) => command === 'node "${PLUGIN_ROOT}/hooks/codex-native-hook.mjs"'),
      'plugin hooks should use Codex PLUGIN_ROOT instead of setup-owned .codex/hooks.json',
    );
    assert.equal(
      hooksManifest.hooks?.PreToolUse?.some((entry) => typeof entry.matcher === 'string'),
      false,
      'plugin PreToolUse hooks must cover non-Bash tools just like setup-owned native hooks',
    );
    assert.deepEqual(mcpManifest, expectedPluginMcpManifest);

    for (const [serverName, server] of Object.entries(mcpManifest.mcpServers ?? {})) {
      assert.equal(server.command, OWX_PLUGIN_MCP_COMMAND, `${serverName} should run via owx`);
      assert.notEqual(server.command, 'node', `${serverName} should not depend on a bare node command`);
      assert.equal(server.enabled, false, `${serverName} should be disabled by default`);
      assert.equal(server.args?.length, 2, `${serverName} should have serve subcommand + public target args`);
      assert.equal(server.args?.[0], OWX_PLUGIN_MCP_SERVE_SUBCOMMAND, `${serverName} should launch through owx mcp-serve`);
      const target = server.args?.[1];
      assert.ok(target, `${serverName} should declare a public target`);
      assert.equal(target?.includes('..'), false, `${serverName} should not depend on path traversal outside the plugin root`);
      assert.equal(OWX_FIRST_PARTY_MCP_PLUGIN_TARGETS.includes(target ?? ''), true, `${serverName} should use a stable public OWX MCP target`);
      assert.equal(target?.endsWith('-server.js'), false, `${serverName} should not expose internal dist filenames in plugin metadata`);
    }
  });

  it('observes retained App lifecycle events without an OWX launcher', async () => {
    await withPluginCacheCopy(async (cachePluginRoot, cacheRoot) => {
      const entrypoint = await readFile(join(cachePluginRoot, 'hooks', 'codex-native-hook.mjs'), 'utf-8');
      assert.doesNotMatch(entrypoint, /owx-command\.json|dist\/cli\/owx\.js/);
      await stat(join(cachePluginRoot, 'hooks', 'project-hook-runner.mjs'));
      const hooksManifest = await readJson<{ hooks?: Record<string, unknown> }>(join(cachePluginRoot, 'hooks', 'hooks.json'));
      const sessionId = 'sess-plugin-standalone-events';
      await mkdir(join(cachePluginRoot, '.owx', 'hooks'), { recursive: true });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'hooks', 'plugins', 'observe', 'data.json'), {
        prior_surface: 'canonical-sdk',
      });
      await writeFile(join(cachePluginRoot, '.owx', 'hooks', 'observe.mjs'), [
        'export async function onHookEvent(event, sdk) {',
        "  await sdk.state.write('observed_prior', await sdk.state.read('prior_surface'));",
        "  await sdk.state.write('last_event', event.event);",
        "  await sdk.state.write('runtime_session_id', (await sdk.owx.session.read())?.session_id ?? null);",
        "  await sdk.state.write('runtime_hud_turn_count', (await sdk.owx.hud.read())?.turn_count ?? null);",
        "  try { await sdk.state.write('../escape', true); } catch { await sdk.state.write('invalid_key_rejected', true); }",
        "  if (event.event === 'keyword-detector') await sdk.state.write('prompt_seen', ['prompt', 'input', 'user_prompt', 'userPrompt', 'text'].some((key) => key in event.context));",
        "  await sdk.log.info('observed', { source: event.source });",
        '}',
        '',
      ].join('\n'));
      const sessionStart = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: sessionId,
        thread_id: 'thread-leader',
        cwd: cachePluginRoot,
      }), {
        PATH: join(cacheRoot, 'empty-bin'),
        OWX_NATIVE_HOOK_COMMAND: join(cacheRoot, 'missing-owx'),
      });
      assert.equal(sessionStart.status, 0, sessionStart.stderr || sessionStart.stdout);
      const sessionStartOutput = parseSingleJsonStdout(sessionStart.stdout);
      assert.match(JSON.stringify(sessionStartOutput), /native subagents directly/);
      assert.equal(sessionStart.stderr, '');

      const session = await readJson<{ session_id: string; cwd: string }>(
        join(cachePluginRoot, '.owx', 'state', 'session.json'),
      );
      assert.equal(session.session_id, sessionId);
      assert.equal(session.cwd, cachePluginRoot);
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'hud-state.json'), { turn_count: 99 });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'hud-state.json'), { turn_count: 3 });

      const promptSubmit = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: sessionId,
        thread_id: 'thread-leader',
        cwd: cachePluginRoot,
        prompt: '$ralplan make a careful plan',
      }));
      assert.equal(promptSubmit.status, 0, promptSubmit.stderr || promptSubmit.stdout);
      assert.match(JSON.stringify(parseSingleJsonStdout(promptSubmit.stdout)), /\$ralplan/);
      const skillState = await readJson<{ skill: string; source: string }>(
        join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'skill-active-state.json'),
      );
      assert.equal(skillState.skill, 'ralplan');
      assert.equal(skillState.source, 'plugin-user-prompt-submit');

      const postToolUse = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        thread_id: 'thread-leader',
        turn_id: 'turn-1',
        cwd: cachePluginRoot,
        tool_name: 'spawn_agent',
        tool_input: { agent_type: 'architect' },
        tool_response: { thread_id: 'thread-child', status: 'running' },
      }));
      assert.equal(postToolUse.status, 0, postToolUse.stderr || postToolUse.stdout);
      assert.equal(postToolUse.stdout, '');
      const tracking = await readJson<{
        sessions: Record<string, { threads: Record<string, {
          thread_id: string;
          kind: string;
          first_seen_at: string;
          last_seen_at: string;
          turn_count: number;
          last_turn_id: string;
          role: string;
          provenance_kind: string;
        }> }>;
      }>(join(cachePluginRoot, '.owx', 'state', 'subagent-tracking.json'));
      assert.deepEqual(
        tracking.sessions[sessionId]?.threads['thread-child'],
        {
          thread_id: 'thread-child',
          kind: 'subagent',
          first_seen_at: tracking.sessions[sessionId]?.threads['thread-child']?.first_seen_at,
          last_seen_at: tracking.sessions[sessionId]?.threads['thread-child']?.last_seen_at,
          turn_count: 1,
          last_turn_id: 'turn-1',
          role: 'architect',
          provenance_kind: 'native_tool_result',
        },
      );

      for (const hookEventName of Object.keys(hooksManifest.hooks ?? {})
        .filter((name) => !['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'].includes(name))) {
        const result = runPluginNativeHook(cachePluginRoot, JSON.stringify({
          hook_event_name: hookEventName,
          session_id: sessionId,
          cwd: cachePluginRoot,
        }), {
          PATH: join(cacheRoot, 'empty-bin'),
          OWX_NATIVE_HOOK_COMMAND: join(cacheRoot, 'missing-owx'),
        });
        assert.equal(result.status, 0, `${hookEventName}: ${result.stderr || result.stdout}`);
        assert.equal(result.stdout, '', `${hookEventName} should not emit hook output`);
        assert.equal(result.stderr, '', `${hookEventName} should not emit diagnostics`);
      }

      const logsDir = join(cachePluginRoot, '.owx', 'logs');
      const lifecycleLogs = (await readdir(logsDir)).filter((name) => name.startsWith('native-hooks-'));
      assert.equal(lifecycleLogs.length, 1);
      const lifecycleLog = await readFile(join(logsDir, lifecycleLogs[0]), 'utf-8');
      for (const eventName of Object.keys(hooksManifest.hooks ?? {}).filter((name) => name !== 'Stop')) {
        assert.match(lifecycleLog, new RegExp(`"event":"${eventName}"`));
      }
      const hookPluginState = await readJson<{
        last_event: string;
        observed_prior: string;
        prompt_seen: boolean;
        invalid_key_rejected: boolean;
        runtime_session_id: string;
        runtime_hud_turn_count: number;
      }>(
        join(cachePluginRoot, '.owx', 'state', 'hooks', 'plugins', 'observe', 'data.json'),
      );
      assert.equal(hookPluginState.last_event, 'post-compact');
      assert.equal(hookPluginState.observed_prior, 'canonical-sdk');
      assert.equal(hookPluginState.prompt_seen, false);
      assert.equal(hookPluginState.invalid_key_rejected, true);
      assert.equal(hookPluginState.runtime_session_id, sessionId);
      assert.equal(hookPluginState.runtime_hud_turn_count, 3);
      assert.match(lifecycleLog, /"event":"hook-plugin-dispatch"/);
    });
  });

  it('normalizes invalid session state through the standalone project hook SDK', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      await mkdir(join(cachePluginRoot, '.owx', 'hooks'), { recursive: true });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'session.json'), { session_id: '', cwd: cachePluginRoot });
      await writeFile(join(cachePluginRoot, '.owx', 'hooks', 'session-reader.mjs'), [
        'export async function onHookEvent(_event, sdk) {',
        "  await sdk.state.write('session_is_null', (await sdk.owx.session.read()) === null);",
        '}',
        '',
      ].join('\n'));
      const result = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreCompact',
        cwd: cachePluginRoot,
      }));
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const pluginState = await readJson<{ session_is_null: boolean }>(
        join(cachePluginRoot, '.owx', 'state', 'hooks', 'plugins', 'session-reader', 'data.json'),
      );
      assert.equal(pluginState.session_is_null, true);
    });
  });

  it('enforces retained Ralplan and Deep-interview PreToolUse boundaries', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const sessionId = 'sess-plugin-planning-boundary';
      const sessionDir = join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId);
      const start = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'SessionStart', session_id: sessionId, cwd: cachePluginRoot,
      }));
      assert.equal(start.status, 0, start.stderr || start.stdout);

      await writeJson(join(sessionDir, 'skill-active-state.json'), {
        version: 1,
        active: true,
        skill: 'ralplan',
        session_id: sessionId,
        active_skills: [{ skill: 'ralplan', active: true, session_id: sessionId }],
      });
      await writeJson(join(sessionDir, 'ralplan-state.json'), {
        mode: 'ralplan', active: true, current_phase: 'planning', session_id: sessionId,
      });
      const ralplanBlocked = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: cachePluginRoot,
        tool_name: 'Write',
        tool_input: { file_path: 'src/implementation.ts' },
      }));
      assert.equal(ralplanBlocked.status, 0, ralplanBlocked.stderr || ralplanBlocked.stdout);
      assert.equal(parseSingleJsonStdout(ralplanBlocked.stdout).decision, 'block');

      const ralplanArtifact = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: cachePluginRoot,
        tool_name: 'Write',
        tool_input: { file_path: '.owx/plans/retained.md' },
      }));
      assert.equal(ralplanArtifact.status, 0, ralplanArtifact.stderr || ralplanArtifact.stdout);
      assert.equal(ralplanArtifact.stdout, '');

      const stateWrite = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: cachePluginRoot,
        tool_name: 'Write',
        tool_input: { file_path: '.owx/state/escape.json' },
      }));
      assert.equal(parseSingleJsonStdout(stateWrite.stdout).decision, 'block');

      const mixedMove = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: cachePluginRoot,
        tool_name: 'Bash',
        tool_input: { command: 'mv .owx/plans/draft.md src/implementation.ts' },
      }));
      assert.equal(parseSingleJsonStdout(mixedMove.stdout).decision, 'block');

      for (const command of [
        'FOO=bar mv .owx/plans/draft.md src/implementation.ts',
        'install .owx/plans/draft.md src/implementation.ts',
        'find src -type f -delete',
        'find src -type f -fprint src/generated.txt',
        'sort -o src/generated.txt .owx/plans/draft.md',
        'sort --temporary-directory=src .owx/plans/draft.md',
        'uniq .owx/plans/draft.md src/generated.txt',
        "yq -i '.x = 1' src/config.yml",
        'git diff --output=src/patch.diff',
        'git grep -O./scripts/mutate.sh planning',
        'git -ccore.fsmonitor=./scripts/mutate.sh status',
        'git -cdiff.external=./scripts/mutate.sh diff',
        'git diff -- .owx/plans',
        'echo planning & touch src/implementation.ts',
        './scripts/rg planning .owx/plans',
        '"echo"/../scripts/jq',
        "rg --pre='touch src/pre-ran' planning .owx/plans",
        'rg "--pre=./scripts/mutate.sh" planning .owx/plans',
        'file -C -m src/custom.magic',
        'cat =(touch src/implementation.ts)',
        "echo *(e:'touch src/implementation.ts':)",
        'printf -v PATH ./scripts && jq',
        'echo ${ touch src/implementation.ts; }',
        "sh -c 'mv .owx/plans/draft.md src/implementation.ts'",
        'echo $(touch src/implementation.ts)',
        'command_name=mv; $command_name .owx/plans/draft.md src/implementation.ts',
      ]) {
        const adversarial = runPluginNativeHook(cachePluginRoot, JSON.stringify({
          hook_event_name: 'PreToolUse',
          session_id: sessionId,
          cwd: cachePluginRoot,
          tool_name: 'Bash',
          tool_input: { command },
        }));
        assert.equal(parseSingleJsonStdout(adversarial.stdout).decision, 'block', command);
      }

      const readOnlyCommand = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: cachePluginRoot,
        tool_name: 'Bash',
        tool_input: { command: 'grep -n "planning" .owx/plans/retained.md && cat .owx/plans/retained.md' },
      }));
      assert.equal(readOnlyCommand.status, 0, readOnlyCommand.stderr || readOnlyCommand.stdout);
      assert.equal(readOnlyCommand.stdout, '');

      await mkdir(join(cachePluginRoot, '.owx', 'plans'), { recursive: true });
      await mkdir(join(cachePluginRoot, 'src'), { recursive: true });
      await symlink(join(cachePluginRoot, 'src'), join(cachePluginRoot, '.owx', 'plans', 'linked-src'));
      const symlinkWrite = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: cachePluginRoot,
        tool_name: 'Write',
        tool_input: { file_path: '.owx/plans/linked-src/escape.ts' },
      }));
      assert.equal(parseSingleJsonStdout(symlinkWrite.stdout).decision, 'block');

      await writeJson(join(sessionDir, 'skill-active-state.json'), {
        version: 1,
        active: true,
        skill: 'deep-interview',
        session_id: sessionId,
        active_skills: [{ skill: 'deep-interview', active: true, session_id: sessionId }],
      });
      await writeJson(join(sessionDir, 'deep-interview-state.json'), {
        mode: 'deep-interview', active: true, current_phase: 'interviewing', session_id: sessionId,
      });
      const interviewBlocked = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: cachePluginRoot,
        tool_name: 'apply_patch',
        tool_input: { patch: '*** Update File: src/implementation.ts' },
      }));
      assert.equal(interviewBlocked.status, 0, interviewBlocked.stderr || interviewBlocked.stdout);
      assert.equal(parseSingleJsonStdout(interviewBlocked.stdout).decision, 'block');
      assert.match(interviewBlocked.stdout, /Deep-interview/);
    });
  });

  it('isolates and terminates timed-out standalone project hook plugins', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      await mkdir(join(cachePluginRoot, '.owx', 'hooks'), { recursive: true });
      await writeFile(join(cachePluginRoot, '.owx', 'hooks', 'loop.mjs'), [
        'export function onHookEvent() {',
        '  for (;;) {}',
        '}',
        '',
      ].join('\n'));
      const startedAt = Date.now();
      const result = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PreCompact',
        session_id: 'sess-plugin-timeout',
        cwd: cachePluginRoot,
      }), { OWX_HOOK_PLUGIN_TIMEOUT_MS: '100' });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.ok(Date.now() - startedAt < 2_000, 'timed-out plugin should be terminated promptly');
      const logName = (await readdir(join(cachePluginRoot, '.owx', 'logs')))
        .find((name) => name.startsWith('native-hooks-'));
      assert.ok(logName);
      const lifecycleLog = await readFile(join(cachePluginRoot, '.owx', 'logs', logName), 'utf-8');
      assert.match(lifecycleLog, /"plugin_id":"loop","status":"failed","reason":"timeout"/);
    });
  });

  it('records scoped native support and capacity evidence from PostToolUse', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const sessionId = 'sess-plugin-native-evidence';
      runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'SessionStart', session_id: sessionId, cwd: cachePluginRoot,
      }));
      const unsupported = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        thread_id: 'leader-thread',
        turn_id: 'turn-unsupported',
        cwd: cachePluginRoot,
        tool_name: 'spawn_agent',
        tool_response: { error: 'native subagents unavailable' },
      }));
      assert.equal(unsupported.status, 0, unsupported.stderr || unsupported.stdout);
      const support = await readJson<{ reason: string; source: string; session_id: string }>(
        join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'native-subagent-support.json'),
      );
      assert.deepEqual(
        { reason: support.reason, source: support.source, session_id: support.session_id },
        { reason: 'native_subagents_unsupported', source: 'persisted_support_blocker', session_id: sessionId },
      );

      const capacity = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        thread_id: 'leader-thread',
        turn_id: 'turn-capacity',
        cwd: cachePluginRoot,
        tool_name: 'spawn_agent',
        tool_response: { error: 'agent thread limit reached' },
      }));
      assert.equal(capacity.status, 0, capacity.stderr || capacity.stdout);
      const capacityState = await readJson<{ reason: string; source: string; expires_at: string }>(
        join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'native-subagent-capacity.json'),
      );
      assert.equal(capacityState.reason, 'agent_thread_limit_reached');
      assert.equal(capacityState.source, 'capacity_blocker');
      assert.ok(Date.parse(capacityState.expires_at) > Date.now());
    });
  });

  it('attempts configured outbound lifecycle notifications from the standalone hook', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const codexHome = join(cachePluginRoot, '.codex-notifications');
      await writeJson(join(codexHome, '.owx-config.json'), {
        notifications: {
          enabled: true,
          webhook: { enabled: true, url: 'http://invalid.example/hook' },
          events: { 'session-start': { enabled: true } },
        },
      });
      const result = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'sess-plugin-notification',
        cwd: cachePluginRoot,
      }), { CODEX_HOME: codexHome });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const logName = (await readdir(join(cachePluginRoot, '.owx', 'logs')))
        .find((name) => name.startsWith('notifications-'));
      assert.ok(logName);
      const notificationLog = await readFile(join(cachePluginRoot, '.owx', 'logs', logName), 'utf-8');
      assert.match(notificationLog, /"attempted_platforms":\["webhook"\]/);
      assert.match(notificationLog, /"successful_platforms":\[\]/);
    });
  });

  it('honors standalone notification profile selection and flat fallback', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const codexHome = join(cachePluginRoot, '.codex-profiles');
      await writeJson(join(codexHome, '.owx-config.json'), {
        notifications: {
          enabled: true,
          defaultProfile: 'personal',
          webhook: { enabled: true, url: 'http://flat.invalid/hook' },
          profiles: {
            personal: { enabled: true, discord: { enabled: true, webhookUrl: 'http://personal.invalid/hook' } },
            work: { enabled: true, webhook: { enabled: true, url: 'http://work.invalid/hook' } },
          },
        },
      });
      const selected = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'sess-plugin-selected-profile',
        cwd: cachePluginRoot,
      }), { CODEX_HOME: codexHome, OWX_NOTIFY_PROFILE: 'work' });
      assert.equal(selected.status, 0, selected.stderr || selected.stdout);
      let notificationLogName = (await readdir(join(cachePluginRoot, '.owx', 'logs')))
        .find((name) => name.startsWith('notifications-'));
      assert.ok(notificationLogName);
      let notificationLog = await readFile(join(cachePluginRoot, '.owx', 'logs', notificationLogName), 'utf-8');
      assert.match(notificationLog, /"attempted_platforms":\["webhook"\]/);

      await rm(join(cachePluginRoot, '.owx', 'logs', notificationLogName));
      const fallback = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'sess-plugin-missing-profile',
        cwd: cachePluginRoot,
      }), { CODEX_HOME: codexHome, OWX_NOTIFY_PROFILE: 'missing' });
      assert.equal(fallback.status, 0, fallback.stderr || fallback.stdout);
      notificationLogName = (await readdir(join(cachePluginRoot, '.owx', 'logs')))
        .find((name) => name.startsWith('notifications-'));
      assert.ok(notificationLogName);
      notificationLog = await readFile(join(cachePluginRoot, '.owx', 'logs', notificationLogName), 'utf-8');
      assert.match(notificationLog, /"attempted_platforms":\["webhook"\]/);
    });
  });

  it('suppresses standalone notifications when persistent config is disabled', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const codexHome = join(cachePluginRoot, '.codex-disabled-notifications');
      await writeJson(join(codexHome, '.owx-config.json'), {
        notifications: {
          enabled: false,
          webhook: { enabled: true, url: 'https://should-not-send.invalid/hook' },
        },
      });
      const result = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'sess-plugin-notifications-disabled',
        cwd: cachePluginRoot,
      }), { CODEX_HOME: codexHome });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const logNames = await readdir(join(cachePluginRoot, '.owx', 'logs'));
      assert.equal(logNames.some((name) => name.startsWith('notifications-')), false);
    });
  });

  it('allows Stop when no authoritative active workflow state exists', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const result = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'sess-plugin-no-runtime',
      }), {
        PATH: '',
        OWX_NATIVE_HOOK_COMMAND: join(cachePluginRoot, 'missing-owx'),
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(parseSingleJsonStdout(result.stdout), {});
      assert.equal(result.stderr, '');
    });
  });

  it('blocks Stop only for authoritative current-session active workflow state', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const sessionId = 'sess-plugin-active-workflow';
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'session.json'), {
        session_id: sessionId,
        cwd: cachePluginRoot,
      });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'run-state.json'), {
        version: 1,
        mode: 'ralph',
        active: true,
        outcome: 'continue',
        current_phase: 'executing',
      });
      const result = runPluginNativeHook(cachePluginRoot, JSON.stringify({
        hook_event_name: 'Stop',
        cwd: cachePluginRoot,
        session_id: sessionId,
      }));

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = parseSingleJsonStdout(result.stdout);
      assert.equal(output.decision, 'block');
      assert.equal(output.stopReason, 'plugin_stop_active_workflow');
      assert.match(String(output.reason), /ralph.*executing/);
    });
  });

  it('allows oversized plugin Stop stdin when no active workflow state is present', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const oversizedStop = `{"hook_event_name":"Stop","padding":"${'x'.repeat(1024 * 1024 + 1)}`;
      const result = runPluginNativeHook(cachePluginRoot, oversizedStop);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(parseSingleJsonStdout(result.stdout), {});
    });
  });

  it('blocks oversized plugin Stop stdin when current session autopilot state is active', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const sessionId = 'sess-plugin-oversized-active';
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'session.json'), { session_id: sessionId });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'autopilot-state.json'), {
        active: true,
        current_phase: 'execution',
      });
      const oversizedStop = `{"hook_event_name":"Stop","cwd":"${cachePluginRoot}","session_id":"${sessionId}","padding":"${'x'.repeat(1024 * 1024 + 1)}`;
      const result = runPluginNativeHook(cachePluginRoot, oversizedStop);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = parseSingleJsonStdout(result.stdout);
      assert.equal(output.decision, 'block');
      assert.equal(output.stopReason, 'plugin_stop_active_workflow');
    });
  });

  it('does not let unrelated terminal run-state suppress active plugin Autopilot oversized Stop blocking', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const sessionId = 'sess-plugin-oversized-unrelated-terminal';
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'session.json'), { session_id: sessionId });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'autopilot-state.json'), {
        active: true,
        current_phase: 'execution',
      });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'run-state.json'), {
        mode: 'ralph',
        active: false,
        outcome: 'finish',
      });
      const oversizedStop = `{"hook_event_name":"Stop","cwd":"${cachePluginRoot}","session_id":"${sessionId}","padding":"${'x'.repeat(1024 * 1024 + 1)}`;
      const result = runPluginNativeHook(cachePluginRoot, oversizedStop);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = parseSingleJsonStdout(result.stdout);
      assert.equal(output.decision, 'block');
      assert.equal(output.stopReason, 'plugin_stop_active_workflow');
    });
  });

  it('allows oversized plugin Stop stdin when terminal Autopilot run-state shadows stale active state', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const sessionId = 'sess-plugin-oversized-terminal-autopilot';
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'session.json'), { session_id: sessionId });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'autopilot-state.json'), {
        active: true,
        current_phase: 'execution',
      });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'run-state.json'), {
        mode: 'autopilot',
        active: false,
        outcome: 'blocked_on_user',
      });
      const oversizedStop = `{"hook_event_name":"Stop","cwd":"${cachePluginRoot}","session_id":"${sessionId}","padding":"${'x'.repeat(1024 * 1024 + 1)}`;
      const result = runPluginNativeHook(cachePluginRoot, oversizedStop);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(parseSingleJsonStdout(result.stdout), {});
    });
  });

  it('detects active plugin Autopilot state for oversized Stop under OWX_ROOT', async () => {
    await withPluginCacheCopy(async (cachePluginRoot, cacheRoot) => {
      const sessionId = 'sess-plugin-oversized-owx-root';
      const owxRoot = join(cacheRoot, 'boxed-root');
      await writeJson(join(owxRoot, '.owx', 'state', 'session.json'), { session_id: sessionId });
      await writeJson(join(owxRoot, '.owx', 'state', 'sessions', sessionId, 'autopilot-state.json'), {
        active: true,
        current_phase: 'execution',
      });
      const oversizedStop = `{"hook_event_name":"Stop","cwd":"${cachePluginRoot}","session_id":"${sessionId}","padding":"${'x'.repeat(1024 * 1024 + 1)}`;
      const result = runPluginNativeHook(cachePluginRoot, oversizedStop, { OWX_ROOT: owxRoot });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = parseSingleJsonStdout(result.stdout);
      assert.equal(output.decision, 'block');
      assert.equal(output.stopReason, 'plugin_stop_active_workflow');
    });
  });

  it('lets terminal OWX_ROOT Autopilot state override stale cwd active state for oversized Stop', async () => {
    await withPluginCacheCopy(async (cachePluginRoot, cacheRoot) => {
      const sessionId = 'sess-plugin-oversized-owx-root-terminal';
      const owxRoot = join(cacheRoot, 'boxed-root-terminal');
      await writeJson(join(owxRoot, '.owx', 'state', 'session.json'), { session_id: sessionId });
      await writeJson(join(owxRoot, '.owx', 'state', 'sessions', sessionId, 'run-state.json'), {
        mode: 'autopilot',
        outcome: 'blocked_on_user',
      });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'session.json'), { session_id: sessionId });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'autopilot-state.json'), {
        active: true,
        current_phase: 'execution',
      });
      const oversizedStop = `{"hook_event_name":"Stop","cwd":"${cachePluginRoot}","session_id":"${sessionId}","padding":"${'x'.repeat(1024 * 1024 + 1)}`;
      const result = runPluginNativeHook(cachePluginRoot, oversizedStop, { OWX_ROOT: owxRoot });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(parseSingleJsonStdout(result.stdout), {});
    });
  });

  it('allows oversized plugin Stop when Autopilot state is active but terminal by phase', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const sessionId = 'sess-plugin-oversized-terminal-phase';
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'session.json'), { session_id: sessionId });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'autopilot-state.json'), {
        active: true,
        current_phase: 'complete',
      });
      const oversizedStop = `{"hook_event_name":"Stop","cwd":"${cachePluginRoot}","session_id":"${sessionId}","padding":"${'x'.repeat(1024 * 1024 + 1)}`;
      const result = runPluginNativeHook(cachePluginRoot, oversizedStop);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(parseSingleJsonStdout(result.stdout), {});
    });
  });

  it('ignores stale plugin session state whose cwd does not match oversized Stop cwd', async () => {
    await withPluginCacheCopy(async (cachePluginRoot, cacheRoot) => {
      const sessionId = 'sess-plugin-oversized-stale-cwd';
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'session.json'), {
        session_id: sessionId,
        cwd: join(cacheRoot, 'different-cwd'),
      });
      await writeJson(join(cachePluginRoot, '.owx', 'state', 'sessions', sessionId, 'autopilot-state.json'), {
        active: true,
        current_phase: 'execution',
      });
      const oversizedStop = `{"hook_event_name":"Stop","cwd":"${cachePluginRoot}","session_id":"${sessionId}","padding":"${'x'.repeat(1024 * 1024 + 1)}`;
      const result = runPluginNativeHook(cachePluginRoot, oversizedStop);

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(parseSingleJsonStdout(result.stdout), {});
    });
  });

  it('fails oversized non-Stop plugin stdin without Stop JSON', async () => {
    await withPluginCacheCopy(async (cachePluginRoot) => {
      const result = runPluginNativeHook(cachePluginRoot, 'x'.repeat(1024 * 1024 + 1));

      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /plugin hook stdin exceeded/);
    });
  });

  it('keeps plugin MCP metadata aligned with the explicit compat setup-managed MCP roster', async () => {
    const mcpManifest = await readJson<PluginMcpManifest>(pluginMcpPath);
    const defaultConfig = buildMergedConfig('', root, { includeTui: false });
    assert.doesNotMatch(
      defaultConfig,
      /^\[mcp_servers\.owx_state\]$/m,
      'default setup config should stay CLI-first without first-party MCP tables',
    );
    const mergedConfig = buildMergedConfig('', root, { includeTui: false, includeFirstPartyMcp: true });
    const setupManagedServers = [...mergedConfig.matchAll(/^\[mcp_servers\.(owx_[^\]]+)\]$/gm)]
      .map((match) => match[1])
      .sort();

    assert.deepEqual(
      setupManagedServers,
      [...OWX_FIRST_PARTY_MCP_SERVER_NAMES].sort(),
      'setup should expose the canonical first-party OWX MCP roster',
    );
    assert.deepEqual(setupManagedServers, Object.keys(mcpManifest.mcpServers ?? {}).sort());

    const targetToEntrypoint = new Map(
      OWX_FIRST_PARTY_MCP_PLUGIN_TARGETS.map((target, index) => [target, OWX_FIRST_PARTY_MCP_ENTRYPOINTS[index]]),
    );

    for (const [serverName, server] of Object.entries(mcpManifest.mcpServers ?? {})) {
      const target = server.args?.[1] ?? '';
      const entrypoint = targetToEntrypoint.get(target);
      assert.ok(entrypoint, `${serverName} should expose a canonical public target`);
      assert.match(
        mergedConfig,
        new RegExp(`\\[mcp_servers\\.${escapeRegex(serverName)}\\][\\s\\S]*?${escapeRegex(entrypoint)}`),
        `${serverName} should stay aligned with the setup-managed MCP entrypoint`,
      );
    }
  });

  it('launches plugin MCP public targets from a cache-style plugin root via the installed owx CLI', async () => {
    for (const target of OWX_FIRST_PARTY_MCP_PLUGIN_TARGETS) {
      await assertPluginCacheLaunchable(target);
    }
  });

  it('launches the plugin-scoped native hook for PostCompact from a cache-style plugin root', async () => {
    await assertPluginHookLaunchesPostCompactFromCache();
  });

  it('does not stage setup-owned hook or runtime directories inside the plugin', async () => {
    const pluginEntries = await readdir(pluginRoot);

    assert.equal(pluginEntries.includes('.codex'), false, 'official plugin should not ship setup-owned .codex hook assets');
    assert.equal(pluginEntries.includes('.owx'), false, 'official plugin should not ship runtime hook directories');
    assert.equal(pluginEntries.includes('hooks.json'), false, 'official plugin hook metadata should stay under hooks/');
    assert.equal(pluginEntries.includes('hooks'), true, 'official plugin should ship plugin-scoped lifecycle hooks');
    await stat(pluginHookLauncherPath);
  });

  it('registers the plugin in the repo marketplace with explicit source, policy, and category', async () => {
    const marketplace = await readJson<Marketplace>(marketplacePath);
    const entry = marketplace.plugins?.find((candidate) => candidate.name === pluginName);

    assert.equal(marketplace.name, 'owen-codex-local');
    assert.equal(marketplace.interface?.displayName, 'owen-codex Local Plugins');
    assert.ok(entry, 'expected marketplace entry for owen-codex');
    assert.equal(entry.source?.source, 'local');
    assert.equal(entry.source?.path, './plugins/owen-codex');
    assert.equal(entry.policy?.installation, 'AVAILABLE');
    assert.equal(entry.policy?.authentication, 'ON_INSTALL');
    assert.equal(entry.category, 'Developer Tools');
  });

  it('mirrors exactly the setup-installable skill subset from the canonical root skills', async () => {
    const manifest = await readJson<CatalogManifest>(join(root, 'src', 'catalog', 'manifest.json'));
    const expectedSkillNames = [...getSetupInstallableSkillNames(manifest)].sort();

    const pluginSkillEntries = await readdir(join(pluginRoot, 'skills'), { withFileTypes: true });
    const actualSkillNames = pluginSkillEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    assert.deepEqual(actualSkillNames, expectedSkillNames);
    assert.ok(actualSkillNames.includes('performance-goal'), 'performance-goal should be available through setup/plugin skill delivery');
    assert.ok(actualSkillNames.includes('autoresearch-goal'), 'autoresearch-goal should be available through setup/plugin skill delivery');
    assert.ok(actualSkillNames.includes('ultragoal'), 'ultragoal should remain available through setup/plugin skill delivery');
    assert.equal(actualSkillNames.includes('ecomode'), false, 'deprecated skills should not be mirrored');
    assert.equal(actualSkillNames.includes('configure-discord'), false, 'merged notification aliases should not be mirrored');

    for (const skillName of expectedSkillNames) {
      const rootSkillDir = join(root, 'skills', skillName);
      const pluginSkillDir = join(pluginRoot, 'skills', skillName);
      const [rootStat, pluginStat] = await Promise.all([stat(rootSkillDir), stat(pluginSkillDir)]);
      assert.equal(rootStat.isDirectory(), true, `${skillName} root skill should be a directory`);
      assert.equal(pluginStat.isDirectory(), true, `${skillName} plugin skill should be a directory`);

      const [rootFiles, pluginFiles] = await Promise.all([
        listFiles(rootSkillDir),
        listFiles(pluginSkillDir),
      ]);
      assert.deepEqual(pluginFiles, rootFiles, `${skillName} plugin file list should match root skill`);

      for (const file of rootFiles) {
        const [rootContent, pluginContent] = await Promise.all([
          readFile(join(rootSkillDir, file), 'utf-8'),
          readFile(join(pluginSkillDir, file), 'utf-8'),
        ]);
        assert.equal(pluginContent, rootContent, `${skillName}/${file} should match canonical root skill file`);
      }
    }
  });

  it('keeps marketplace-aware cache semantics out of user-facing runtime surfaces', async () => {
    const staleCachePath = '~/.codex/plugins/cache/omc/owen-codex';
    const surfacesToCheck = [
      'skills/doctor/SKILL.md',
      'skills/help/SKILL.md',
      'plugins/owen-codex/skills/doctor/SKILL.md',
      'plugins/owen-codex/skills/owx-setup/SKILL.md',
    ];

    for (const surfacePath of surfacesToCheck) {
      const content = await readFile(join(root, surfacePath), 'utf-8');
      assert.equal(content.includes(staleCachePath), false, `${surfacePath} should not hard-code stale omc cache path`);
    }

    const combinedSurfaces = await Promise.all(surfacesToCheck.map((surfacePath) => readFile(join(root, surfacePath), 'utf-8')));
    const combined = combinedSurfaces.join('\n');
    assert.match(combined, /plugins\/cache\/\$MARKETPLACE_NAME\/owen-codex\/\$VERSION\//);
    assert.match(combined, /not a replacement for `npm install -g owen-codex` plus `owx setup`/);
    assert.match(combined, /legacy setup mode installs native agents(?:\/| and )prompts|plugin setup mode archives stale legacy prompt\/native-agent files/);
    assert.match(combined, /plugin-scoped companion metadata for official Codex lifecycle hooks/i);
    assert.match(combined, /legacy\/fallback native Codex hook registrations|legacy setup mode installs prompts\/native agents and \.codex\/hooks\.json/i);
  });
});
