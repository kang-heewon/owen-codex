import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMergedConfig,
  FRONTEND_PR_MEDIA_INSTRUCTIONS,
  FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS,
  HUMAN_COMMUNICATION_INSTRUCTIONS,
  mergeConfig,
  OWX_DEVELOPER_INSTRUCTIONS,
  OWX_PLUGIN_DEVELOPER_INSTRUCTIONS,
  upsertPluginModeRuntimeFeatureFlags,
} from '../generator.js';

describe('config generator', () => {
  it('shares one human communication contract across setup modes', () => {
    assert.ok(OWX_DEVELOPER_INSTRUCTIONS.includes(HUMAN_COMMUNICATION_INSTRUCTIONS));
    assert.ok(OWX_PLUGIN_DEVELOPER_INSTRUCTIONS.includes(HUMAN_COMMUNICATION_INSTRUCTIONS));
    assert.match(HUMAN_COMMUNICATION_INSTRUCTIONS, /reader's task, not for an evaluator/i);
    assert.match(HUMAN_COMMUNICATION_INSTRUCTIONS, /Never invent specificity, examples, numbers, personal experience, or opinions/i);
    assert.match(HUMAN_COMMUNICATION_INSTRUCTIONS, /Korean practitioners use in that context/i);
  });

  it('shares one frontend visual evidence contract across setup modes', () => {
    assert.ok(OWX_DEVELOPER_INSTRUCTIONS.includes(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS));
    assert.ok(OWX_PLUGIN_DEVELOPER_INSTRUCTIONS.includes(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS));
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /does not depend on a design skill/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /real browser/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /Capture final screenshots/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /Treat a change as UX-visible/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /interaction sequence.*navigation.*state transition/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /For every UX-visible change, capture a short screen recording/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /starting state.*changed interaction.*outcome/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /Screenshots do not replace the required recording/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /recordings.*absolute paths/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /absolute paths/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /required recording cannot run/i);
    assert.match(FRONTEND_VISUAL_EVIDENCE_INSTRUCTIONS, /do not claim the frontend or UX work is complete/i);
  });

  it('shares one frontend PR media contract across setup modes', () => {
    assert.ok(OWX_DEVELOPER_INSTRUCTIONS.includes(FRONTEND_PR_MEDIA_INSTRUCTIONS));
    assert.ok(OWX_PLUGIN_DEVELOPER_INSTRUCTIONS.includes(FRONTEND_PR_MEDIA_INSTRUCTIONS));
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /## Visual evidence/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /GitHub-hosted URLs/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /route, state, and viewport labels/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /local filesystem paths are not valid PR evidence/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /Screenshots are required baseline evidence/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /Every UX-visible change also requires its screen recording/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /starting state, changed interaction, and outcome/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /A recording is optional only for a purely visual change/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /H\.264 MP4/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /without secrets, tokens, personal data, or unrelated user content/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /verify every image and recording renders/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /do not claim the PR handoff is complete or merge-ready/i);
    assert.match(FRONTEND_PR_MEDIA_INSTRUCTIONS, /When no pull request exists, keep the labeled absolute local paths/i);
  });

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
      const featuresIdx = toml.indexOf('[features]');

      assert.ok(notifyIdx >= 0, 'notify not found');
      assert.ok(reasoningIdx >= 0, 'model_reasoning_effort not found');
      assert.ok(devInstrIdx >= 0, 'developer_instructions not found');
      assert.ok(featuresIdx >= 0, '[features] not found');

      assert.ok(notifyIdx < featuresIdx, 'notify must come before [features]');
      assert.ok(reasoningIdx < featuresIdx, 'model_reasoning_effort must come before [features]');
      assert.ok(devInstrIdx < featuresIdx, 'developer_instructions must come before [features]');
      assert.doesNotMatch(toml, /^model\s*=/m);
      assert.doesNotMatch(toml, /^model_context_window\s*=/m);
      assert.doesNotMatch(toml, /^model_auto_compact_token_limit\s*=/m);
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

  it('does not seed model or context defaults for fresh configs', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.doesNotMatch(toml, /^model\s*=/m);
      assert.doesNotMatch(toml, /seeded behavioral defaults/);
      assert.doesNotMatch(toml, /^model_context_window\s*=/m);
      assert.doesNotMatch(toml, /^model_auto_compact_token_limit\s*=/m);
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
      assert.match(toml, /Native `agent_type` is the sole authority for a child's role identity/);
      assert.match(toml, /visible `role_identity_unavailable` blocker/);
      assert.match(toml, /Use native subagents directly for independent, bounded work with explicit ownership/);
      assert.match(toml, /Treat installed prompts as narrower execution surfaces under AGENTS\.md authority/);
      assert.match(toml, /Write for the reader's task, not for an evaluator/);
      assert.match(toml, /use structure only when it improves scannability/);
      assert.match(toml, /Never invent specificity, examples, numbers, personal experience, or opinions merely to sound human/);
      assert.match(toml, /vocabulary Korean practitioners use in that context/);
      assert.match(toml, /When shaping product behavior, make the core user loop stronger before adding breadth/);
      assert.match(toml, /define explicit success and failure states/);
      assert.match(toml, /never disguise failure as success/);
      assert.match(toml, /Frontend visual verification does not depend on a design skill being invoked/);
      assert.match(toml, /inspect every affected route and state in a real browser/);
      assert.match(toml, /Capture final screenshots for every materially changed surface or state/);
      assert.match(toml, /embed or link them in the completion response with absolute paths/);
      assert.match(toml, /Treat a change as UX-visible/);
      assert.match(toml, /For every UX-visible change, capture a short screen recording/);
      assert.match(toml, /starting state.*changed interaction.*outcome/);
      assert.match(toml, /Screenshots do not replace the required recording/);
      assert.match(toml, /recordings.*absolute paths/);
      assert.match(toml, /add a `## Visual evidence` section to the PR body/);
      assert.match(toml, /resulting GitHub-hosted URLs/);
      assert.match(toml, /route, state, and viewport labels/);
      assert.match(toml, /local filesystem paths are not valid PR evidence/);
      assert.match(toml, /Screenshots are required baseline evidence/);
      assert.match(toml, /Every UX-visible change also requires its screen recording/);
      assert.match(toml, /A recording is optional only for a purely visual change/);
      assert.match(toml, /preferably H\.264 MP4/);
      assert.match(toml, /without secrets, tokens, personal data, or unrelated user content/);
      assert.match(toml, /do not claim the PR handoff is complete or merge-ready/);
      assert.match(toml, /When no pull request exists, keep the labeled absolute local paths/);
      assert.match(toml, /Keep OWX workflow resilience separate from authored-code behavior/);
      assert.match(toml, /Treat explicit failure as a complete and correct implementation/);
      assert.match(toml, /Do not add runtime behavior, product features, public APIs, CLI flags, UI controls, schema fields, or other shipped interfaces solely to enable or simplify verification/);
      assert.match(toml, /any test-only surface must stay outside shipped artifacts and the product contract/);
      assert.match(toml, /defensive programming, test convenience, and a desire to make an operation always succeed are not sufficient justification/);
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

  it('preserves explicit model and context settings without adding a partner value', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'owx-config-gen-'));
    try {
      const configPath = join(wd, 'config.toml');
      await writeFile(
        configPath,
        ['model = "gpt-5.6-sol"', 'model_context_window = 640000', ''].join('\n'),
      );

      await mergeConfig(configPath, wd);
      const toml = await readFile(configPath, 'utf-8');

      assert.match(toml, /^model = "gpt-5\.6-sol"$/m);
      assert.match(toml, /^model_context_window = 640000$/m);
      assert.doesNotMatch(toml, /^model_auto_compact_token_limit\s*=/m);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('does not seed context keys for other models', async () => {
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
        'model_reasoning_effort = "xhigh"',
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
      assert.match(toml, /^model_reasoning_effort = "xhigh"$/m);
      assert.equal((toml.match(/^model_reasoning_effort\s*=/gm) ?? []).length, 1);
      assert.match(toml, /^approval_policy = "on-failure"$/m);

      // OWX keys added
      assert.match(toml, /^notify = \[/m);

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
