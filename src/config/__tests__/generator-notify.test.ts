import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMergedConfig, mergeConfig, OWX_DEVELOPER_INSTRUCTIONS, upsertPluginModeRuntimeFeatureFlags } from '../generator.js';

describe('config generator', () => {
  it('places top-level keys before [features]', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      // Top-level keys must appear before the first [table] header
      const notifyIdx = toml.indexOf('notify =');
      const reasoningIdx = toml.indexOf('model_reasoning_effort =');
      const devInstrIdx = toml.indexOf('developer_instructions =');
      const modelIdx = toml.indexOf('model = "gpt-5.5"');
      const seededStartIdx = toml.indexOf(
        '# owen-codex seeded behavioral defaults (uninstall removes unchanged defaults)',
      );
      const contextIdx = toml.indexOf('model_context_window = 250000');
      const compactIdx = toml.indexOf('model_auto_compact_token_limit = 200000');
      const seededEndIdx = toml.indexOf('# End owen-codex seeded behavioral defaults');
      const featuresIdx = toml.indexOf('[features]');

      assert.ok(notifyIdx >= 0, 'notify not found');
      assert.ok(reasoningIdx >= 0, 'model_reasoning_effort not found');
      assert.ok(devInstrIdx >= 0, 'developer_instructions not found');
      assert.ok(modelIdx >= 0, 'model not found');
      assert.ok(seededStartIdx >= 0, 'seeded defaults start marker not found');
      assert.ok(contextIdx >= 0, 'model_context_window not found');
      assert.ok(compactIdx >= 0, 'model_auto_compact_token_limit not found');
      assert.ok(seededEndIdx >= 0, 'seeded defaults end marker not found');
      assert.ok(featuresIdx >= 0, '[features] not found');

      assert.ok(notifyIdx < featuresIdx, 'notify must come before [features]');
      assert.ok(reasoningIdx < featuresIdx, 'model_reasoning_effort must come before [features]');
      assert.ok(devInstrIdx < featuresIdx, 'developer_instructions must come before [features]');
      assert.ok(modelIdx < featuresIdx, 'model must come before [features]');
      assert.ok(
        seededStartIdx < featuresIdx,
        'seeded defaults start marker must come before [features]',
      );
      assert.ok(contextIdx < featuresIdx, 'model_context_window must come before [features]');
      assert.ok(compactIdx < featuresIdx, 'model_auto_compact_token_limit must come before [features]');
      assert.ok(
        seededEndIdx < featuresIdx,
        'seeded defaults end marker must come before [features]',
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('writes notify as a TOML array', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.match(toml, /^notify = \["node", ".*notify-hook\.js"\]$/m);
      assert.match(toml, /^hooks = true$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('seeds gpt-5.5 model and context defaults for fresh configs', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.match(toml, /^model = "gpt-5\.5"$/m);
      assert.match(
        toml,
        /^# owen-codex seeded behavioral defaults \(uninstall removes unchanged defaults\)$/m,
      );
      assert.match(toml, /^model_context_window = 250000$/m);
      assert.match(toml, /^model_auto_compact_token_limit = 200000$/m);
      assert.match(toml, /^# End owen-codex seeded behavioral defaults$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('seeds default model and context settings on fresh config', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.match(toml, /^model = "gpt-5\.5"$/m);
      assert.match(
        toml,
        /^# owen-codex seeded behavioral defaults \(uninstall removes unchanged defaults\)$/m,
      );
      assert.match(toml, /^model_context_window = 250000$/m);
      assert.match(toml, /^model_auto_compact_token_limit = 200000$/m);
      assert.match(toml, /^# End owen-codex seeded behavioral defaults$/m);

      const modelIdx = toml.indexOf('model = "gpt-5.5"');
      const featuresIdx = toml.indexOf('[features]');
      assert.ok(modelIdx >= 0 && modelIdx < featuresIdx, 'seeded model must come before [features]');
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('writes model_reasoning_effort and strengthened developer_instructions', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.match(toml, /^model_reasoning_effort = "medium"$/m);
      assert.match(toml, /^developer_instructions = "You have owen-codex installed/m);
      assert.match(toml, /AGENTS\.md is the orchestration brain and main control surface/);
      assert.match(toml, /Follow AGENTS\.md for skill\/keyword routing, \$name workflow invocation, and role-specialized subagents/);
      assert.match(toml, /Native subagents live in \.codex\/agents/);
      assert.match(toml, /native surface exposes `agent_type`, set it to an installed role/);
      assert.match(toml, /Codex App surfaces without role routing/);
      assert.match(toml, /exact receipt task_name/);
      assert.match(toml, /Treat installed prompts as narrower execution surfaces under AGENTS\.md authority/);
      assert.match(toml, /When shaping product behavior, make the core user loop stronger before adding breadth/);
      assert.match(toml, /define explicit success and failure states/);
      assert.match(toml, /never disguise failure as success/);
      assert.match(toml, /When authoring source code, implement the intended behavior directly without fallback code/);
      assert.match(toml, /Prefer declarative, immutable, type-safe code/);
      assert.match(toml, /Avoid unnecessary comments/);
      assert.match(toml, new RegExp(`^developer_instructions = "${OWX_DEVELOPER_INSTRUCTIONS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"$`, 'm'));
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('handles paths with spaces in notify array', async () => {
    const base = await mkdtemp(join(tmpdir(), 'owx config gen space-'));
    const wd = join(base, 'pkg root');
    try {
      await mkdir(wd, { recursive: true });
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      const m = toml.match(/^notify = \["node", "(.*)"\]$/m);
      assert.ok(m, 'notify array not found');
      assert.match(m[1], /pkg root/);
      assert.match(m[1], /notify-hook\.js$/);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('re-runs setup replacing OWX config cleanly', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);

      // Simulate user adding content
      let toml = await readFile(configPath, 'utf-8');
      toml += '\n# user tail\n[user.settings]\nname = "kept"\n';
      await writeFile(configPath, toml);

      // Re-run setup
      await mergeConfig(configPath, wd);
      const rerun = await readFile(configPath, 'utf-8');

      // OWX block appears exactly once
      assert.equal(
        (rerun.match(/# owen-codex \(OWX\) Configuration/g) ?? []).length,
        1
      );
      assert.equal((rerun.match(/^# End owen-codex$/gm) ?? []).length, 1);

      // Features correct
      assert.equal((rerun.match(/^\[features\]$/gm) ?? []).length, 1);
      assert.match(rerun, /^multi_agent = true$/m);
      assert.match(rerun, /^child_agents_md = true$/m);

      // User content preserved
      assert.match(rerun, /^\[user.settings\]$/m);
      assert.match(rerun, /^name = "kept"$/m);

      // Top-level keys present and before [features]
      assert.match(rerun, /^notify = \["node", ".*notify-hook\.js"\]$/m);
      assert.match(rerun, /^hooks = true$/m);
      assert.match(rerun, /^model_reasoning_effort = "medium"$/m);
      const notifyIdx = rerun.indexOf('notify =');
      const featuresIdx = rerun.indexOf('[features]');
      assert.ok(notifyIdx < featuresIdx, 'notify must come before [features]');
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('seeds only the missing gpt-5.5 context key while preserving an existing partner value', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await writeFile(
        configPath,
        ['model = "gpt-5.5"', 'model_context_window = 640000', ''].join('\n'),
      );

      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.match(toml, /^model = "gpt-5\.5"$/m);
      assert.match(toml, /^model_context_window = 640000$/m);
      assert.match(toml, /^model_auto_compact_token_limit = 200000$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('does not seed 250k context keys for non-gpt-5.5 models', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await writeFile(configPath, 'model = \"o3\"\n');

      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.match(toml, /^model = "o3"$/m);
      assert.doesNotMatch(toml, /^model_context_window = 250000$/m);
      assert.doesNotMatch(toml, /^model_auto_compact_token_limit = 200000$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves existing user top-level config', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const existing = [
        'model = "o3"',
        'approval_policy = "on-failure"',
        '',
        '[features]',
        'web_search = true',
        '',
      ].join('\n');
      await writeFile(configPath, existing);

      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      // User's existing top-level keys preserved
      assert.match(toml, /^model = "o3"$/m);
      assert.match(toml, /^approval_policy = "on-failure"$/m);

      // OWX keys added
      assert.match(toml, /^notify = \[/m);
      assert.match(toml, /^model_reasoning_effort = "medium"$/m);

      // User's feature flag preserved
      assert.match(toml, /^web_search = true$/m);

      // OWX feature flags added
      assert.match(toml, /^multi_agent = true$/m);
      assert.match(toml, /^goals = true$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('writes a global [agents] section with OWX defaults', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.match(toml, /^\[agents\]$/m);
      assert.match(toml, /^max_threads = 6$/m);
      assert.match(toml, /^max_depth = 2$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('removes deprecated collab flag from [features]', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const existing = [
        '[features]',
        'collab = true',
        'web_search = true',
        '',
        '[user.settings]',
        'name = "kept"',
        '',
      ].join('\n');
      await writeFile(configPath, existing);

      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      // collab must be gone
      assert.ok(!/^\s*collab\s*=/m.test(toml), 'deprecated collab key should be removed');

      // multi_agent replaces it
      assert.match(toml, /^multi_agent = true$/m);

      // other user flags preserved
      assert.match(toml, /^web_search = true$/m);
      assert.match(toml, /^name = "kept"$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('migrates a legacy OWX block and preserves user settings', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const legacy = [
        '[user.before]',
        'name = "kept-before"',
        '',
        '# owen-codex (OWX) Configuration',
        '# legacy block without top divider',
        'notify = ["node", "/tmp/legacy notify-hook.js"]',
        '[mcp_servers.owx_state]',
        'command = "node"',
        'args = ["/tmp/state-server.js"]',
        '# End owen-codex',
        '',
        '[user.after]',
        'name = "kept-after"',
        '',
      ].join('\n');
      await writeFile(configPath, legacy);

      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.equal(
        (toml.match(/owen-codex \(OWX\) Configuration/g) ?? []).length,
        1
      );
      assert.match(toml, /^\[user.before\]$/m);
      assert.match(toml, /^name = "kept-before"$/m);
      assert.match(toml, /^\[user.after\]$/m);
      assert.match(toml, /^name = "kept-after"$/m);
      assert.match(toml, /^notify = \["node", ".*notify-hook\.js"\]$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('merges into existing [features] table without duplicating it', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const original = [
        '[features]',
        'custom_user_flag = false',
        'child_agents_md = false',
        'goal = true',
        'goals = false',
        '',
        '[user.settings]',
        'name = "kept"',
        '',
      ].join('\n');
      await writeFile(configPath, original);

      await mergeConfig(configPath, wd);
      const merged = await readFile(configPath, 'utf-8');

      assert.equal((merged.match(/^\[features\]$/gm) ?? []).length, 1);
      assert.match(merged, /^custom_user_flag = false$/m);
      assert.match(merged, /^multi_agent = true$/m);
      assert.match(merged, /^child_agents_md = true$/m);
      assert.match(merged, /^hooks = true$/m);
      assert.match(merged, /^goals = true$/m);
      assert.doesNotMatch(merged, /^goal\s*=/m);
      assert.match(merged, /^\[user.settings\]$/m);
      assert.match(merged, /^name = "kept"$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('migrates legacy codex_hooks flag to hooks without duplicating hook flags', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const original = [
        '[features]',
        'custom_user_flag = false',
        'codex_hooks = true',
        '',
      ].join('\n');
      await writeFile(configPath, original);

      await mergeConfig(configPath, wd);
      const merged = await readFile(configPath, 'utf-8');

      assert.equal((merged.match(/^hooks = true$/gm) ?? []).length, 1);
      assert.doesNotMatch(merged, /^codex_hooks\s*=/m);
      assert.match(merged, /^custom_user_flag = false$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves existing hooks flag without adding legacy codex_hooks', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const original = [
        '[features]',
        'hooks = true',
        'custom_user_flag = false',
        '',
      ].join('\n');
      await writeFile(configPath, original);

      await mergeConfig(configPath, wd);
      const merged = await readFile(configPath, 'utf-8');

      assert.equal((merged.match(/^hooks = true$/gm) ?? []).length, 1);
      assert.doesNotMatch(merged, /^codex_hooks\s*=/m);
      assert.match(merged, /^custom_user_flag = false$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('can target the legacy codex_hooks flag when requested', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const original = [
        '[features]',
        'hooks = true',
        'custom_user_flag = false',
        '',
      ].join('\n');
      await writeFile(configPath, original);

      await mergeConfig(configPath, wd, { codexHookFeatureFlag: 'codex_hooks' });
      const merged = await readFile(configPath, 'utf-8');

      assert.equal((merged.match(/^codex_hooks = true$/gm) ?? []).length, 1);
      assert.doesNotMatch(merged, /^hooks\s*=/m);
      assert.match(merged, /^custom_user_flag = false$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('dedupes mixed legacy codex_hooks and hooks flags to a single hooks flag', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const original = [
        '[features]',
        'codex_hooks = true',
        'custom_user_flag = false',
        'hooks = false',
        '',
      ].join('\n');
      await writeFile(configPath, original);

      await mergeConfig(configPath, wd);
      const merged = await readFile(configPath, 'utf-8');

      assert.equal((merged.match(/^hooks = true$/gm) ?? []).length, 1);
      assert.doesNotMatch(merged, /^codex_hooks\s*=/m);
      assert.match(merged, /^custom_user_flag = false$/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('normalizes plugin-mode runtime flags to the current hooks flag by default', () => {
    const original = [
      '[features]',
      'custom_user_flag = false',
      'codex_hooks = true',
      'goal = true',
      '',
    ].join('\n');

    const merged = upsertPluginModeRuntimeFeatureFlags(original);

    assert.match(merged, /^hooks = true$/m);
    assert.match(merged, /^goals = true$/m);
    assert.doesNotMatch(merged, /^codex_hooks\s*=/m);
    assert.doesNotMatch(merged, /^goal\s*=/m);
    assert.match(merged, /^custom_user_flag = false$/m);
  });

  it('normalizes plugin-mode runtime flags to legacy codex_hooks when requested', () => {
    const original = [
      '[features]',
      'custom_user_flag = false',
      'codex_hooks = true',
      'goal = true',
      '',
    ].join('\n');

    const merged = upsertPluginModeRuntimeFeatureFlags(original, 'codex_hooks');

    assert.match(merged, /^codex_hooks = true$/m);
    assert.match(merged, /^goals = true$/m);
    assert.doesNotMatch(merged, /^hooks\s*=/m);
    assert.doesNotMatch(merged, /^goal\s*=/m);
    assert.match(merged, /^custom_user_flag = false$/m);
  });

  it('escapes Windows-style backslashes for MCP server args', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      const windowsPkgRoot = 'C:\\Users\\alice\\owen-codex';
      await mergeConfig(configPath, windowsPkgRoot, { includeFirstPartyMcp: true });
      const toml = await readFile(configPath, 'utf-8');

      assert.match(
        toml,
        /args = \["C:\\\\Users\\\\alice\\\\owen-codex\/dist\/mcp\/state-server\.js"\]/,
      );
      assert.match(
        toml,
        /args = \["C:\\\\Users\\\\alice\\\\owen-codex\/dist\/mcp\/memory-server\.js"\]/,
      );
      assert.match(
        toml,
        /args = \["C:\\\\Users\\\\alice\\\\owen-codex\/dist\/mcp\/code-intel-server\.js"\]/,
      );
      assert.match(
        toml,
        /args = \["C:\\\\Users\\\\alice\\\\owen-codex\/dist\/mcp\/trace-server\.js"\]/,
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('does not preserve cross-install OWX notify commands when notify is disabled', () => {
    const pkgRoot = '/current/install/owen-codex';
    const staleConfig = [
      'notify = ["node", "/opt/homebrew/lib/node_modules/owen-codex/dist/scripts/notify-dispatcher.js", "--metadata", "/tmp/notify-dispatch.json"]',
      'approval_policy = "never"',
      '',
    ].join('\n');

    const merged = buildMergedConfig(staleConfig, pkgRoot, { notifyCommand: false });

    assert.doesNotMatch(merged, /^notify\s*=/m);
    assert.doesNotMatch(merged, /notify-dispatcher\.js/);
    assert.match(merged, /^approval_policy = "never"$/m);
  });

  it('does not preserve Windows-style OWX notify hooks when notify is disabled', () => {
    const pkgRoot = 'C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\owen-codex';
    const staleConfig = [
      'notify = ["node", "C:\\\\Users\\\\alice\\\\AppData\\\\Roaming\\\\npm\\\\node_modules\\\\owen-codex\\\\dist\\\\scripts\\\\notify-hook.js"]',
      'approval_policy = "never"',
      '',
    ].join('\n');

    const merged = buildMergedConfig(staleConfig, pkgRoot, { notifyCommand: false });

    assert.doesNotMatch(merged, /^notify\s*=/m);
    assert.doesNotMatch(merged, /notify-hook\.js/);
    assert.match(merged, /^approval_policy = "never"$/m);
  });

  it('does not preserve OWX notify commands invoked through node flags when notify is disabled', () => {
    const pkgRoot = '/current/install/owen-codex';
    const staleConfig = [
      'notify = ["node", "--no-warnings", "/opt/homebrew/lib/node_modules/owen-codex/dist/scripts/notify-hook.js"]',
      'approval_policy = "never"',
      '',
    ].join('\n');

    const merged = buildMergedConfig(staleConfig, pkgRoot, { notifyCommand: false });

    assert.doesNotMatch(merged, /^notify\s*=/m);
    assert.doesNotMatch(merged, /notify-hook\.js/);
    assert.match(merged, /^approval_policy = "never"$/m);
  });

  it('preserves real user notify commands that mention OWX paths as arguments', () => {
    const pkgRoot = '/current/install/owen-codex';
    const userNotify = [
      'notify = ["node", "/tmp/user-notify.js", "/opt/homebrew/lib/node_modules/owen-codex/dist/scripts/notify-hook.js"]',
      'approval_policy = "never"',
      '',
    ].join('\n');

    const merged = buildMergedConfig(userNotify, pkgRoot, { notifyCommand: false });

    assert.match(
      merged,
      /^notify = \["node", "\/tmp\/user-notify\.js", "\/opt\/homebrew\/lib\/node_modules\/owen-codex\/dist\/scripts\/notify-hook\.js"\]$/m,
    );
    assert.match(merged, /^approval_policy = "never"$/m);
  });
});
