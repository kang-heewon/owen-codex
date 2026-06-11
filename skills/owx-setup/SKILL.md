---
name: owx-setup
description: Setup and configure owen-codex using current CLI behavior
---

# OWX Setup

Use this skill when users want to install or refresh owen-codex for the **current project plus user-level OWX directories**.

## Command

```bash
owx setup [--force] [--merge-agents] [--dry-run] [--verbose] [--scope <user|project>] [--plugin|--legacy|--install-mode <legacy|plugin>]
```

If you only want lightweight `AGENTS.md` scaffolding for an existing repo or subtree, use `owx agents-init [path]` instead of full setup.

Supported setup flags (current implementation):
- `--force`: overwrite/reinstall managed artifacts where applicable
- `--merge-agents`: when `AGENTS.md` already exists, preserve user-authored content and insert/refresh OWX-managed generated sections between explicit `<!-- OWX:AGENTS:START -->` / `<!-- OWX:AGENTS:END -->` markers
- `--dry-run`: print actions without mutating files
- `--verbose`: print per-file/per-step details
- `--scope`: choose install scope (`user`, `project`)
- `--plugin`: use Codex plugin delivery for bundled skills while archiving/removing legacy OWX-managed prompts/skills, refreshing setup-owned native agent TOMLs for `agent_type` routing, and keeping setup-owned runtime hooks
- `--legacy`: use legacy setup delivery, overriding any persisted plugin install mode
- `--install-mode`: explicitly choose setup delivery mode (`legacy` or `plugin`); canonical form for scripted setup

## What this setup actually does

`owx setup` performs these steps:

1. Resolve setup scope:
   - `--scope` explicit value
   - else persisted `./.owx/setup-scope.json` (with automatic migration of legacy values)
   - if a TTY user has persisted setup preferences, `owx setup` first summarizes the recorded choices and asks whether to **keep**, **review/change**, or **reset** them
   - else interactive prompt on TTY (default `user`)
   - else default `user` (safe for CI/tests)
2. If scope is `user`, resolve user skill delivery mode:
   - explicit `--plugin`, `--legacy`, or `--install-mode legacy|plugin`, if present
   - persisted install mode in `./.owx/setup-scope.json`, if present and the TTY review decision is `keep`
   - else discovered installed plugin cache under `${CODEX_HOME:-~/.codex}/plugins/cache/**/.codex-plugin/plugin.json` with `name: owen-codex` makes `plugin` the default
   - else interactive prompt on TTY (`legacy` by default, or `plugin` when a plugin cache is discovered)
   - else default `legacy` unless a plugin cache is discovered
3. Create directories and persist effective scope/install mode
4. In legacy mode, install prompts/native agents/skills and merge full config.toml. In plugin mode, archive/remove legacy OWX-managed prompts/skills, refresh installable native agent TOMLs for `agent_type` routing, clean up stale generated non-installable native agents, and keep native Codex hooks installed.
5. Verify Team CLI API interop markers exist in built `dist/cli/team.js`
6. Generate AGENTS.md defaults only when selected/allowed (or legacy behavior outside plugin mode)
7. Configure notify hook references outside plugin mode and write `./.owx/hud-config.json`

## Important behavior notes

- `owx setup` prompts for scope when no scope is provided and stdin/stdout are TTY. If `./.owx/setup-scope.json` already exists, setup now summarizes the saved choices first and asks whether to keep them, review/change them, or reset and behave like a fresh setup run.
- Non-interactive setup never blocks for this review prompt: it keeps deterministic CLI/persisted/default behavior for CI and scripted installs.
- In `user` scope, `owx setup` also prompts for skill delivery mode when no prior install mode is kept; installed plugin cache discovery makes plugin mode the default prompt/non-interactive choice.
- Local project orchestration file is `./AGENTS.md` (project root).
- If `AGENTS.md` exists and neither `--force` nor `--merge-agents` is used, interactive TTY runs ask whether to overwrite. Non-interactive runs preserve the file.
- Use `--merge-agents` to keep existing project guidance while allowing setup to refresh OWX-managed AGENTS sections and the generated model capability table idempotently.
- Scope targets:
  - `user`: user directories (`~/.codex`, `~/.codex/skills`, `~/.owx/agents`)
  - `project`: local directories (`./.codex`, `./.codex/skills`, `./.owx/agents`)
- User-scope skill delivery targets:
  - `legacy`: keep installing/updating OWX skills in the resolved user skill root
  - `plugin`: rely on Codex plugin discovery for bundled skills and plugin-scoped lifecycle hooks when Codex reports `plugin_hooks`; archive/remove legacy OWX-managed prompts/skills, refresh installable setup-owned native agent TOMLs for `agent_type` routing, and remove only stale generated/non-installable native agents. Setup still enables setup-owned runtime feature flags (`plugin_hooks = true` and `goals = true` when supported, or legacy setup-managed `hooks`/`codex_hooks` fallback when plugin hooks are not reported).
- Migration hint: in `user` scope, if historical `~/.agents/skills` still exists alongside `${CODEX_HOME:-~/.codex}/skills`, current setup prints a cleanup hint. **Why the paths differ**: `${CODEX_HOME:-~/.codex}/skills/` is the path current Codex CLI natively loads as its skill root; `~/.agents/skills/` was the skill root in an older Codex CLI release before `~/.codex` became the standard home directory. OWX writes only to the canonical `${CODEX_HOME:-~/.codex}/skills/` path. When both directories exist simultaneously, Codex discovers skills from both trees and may show duplicate entries in Enable/Disable Skills. Archive or remove `~/.agents/skills/` to resolve this.
- If persisted scope is `project`, `owx` launch automatically uses `CODEX_HOME=./.codex` unless user explicitly overrides `CODEX_HOME`.
- Plugin mode prompts separately for optional AGENTS.md defaults and optional `developer_instructions` defaults. If `developer_instructions` already exists, setup asks before overwriting it; non-interactive runs preserve it.
- With `--force` or `--merge-agents`, AGENTS updates may still be skipped if an active OWX session is detected (safety guard).
- Legacy persisted scope values (`project-local`) are automatically migrated to `project` with a one-time warning.

## Setup-owned configuration surfaces

Use this map when reconciling setup behavior or debugging a confusing install:

| Surface | Owner | Notes |
| --- | --- | --- |
| `./.owx/setup-scope.json` | `owx setup` | Persists setup scope and user-scope skill delivery mode. TTY reruns summarize it and offer keep/review/reset. |
| `~/.codex/config.toml` / `./.codex/config.toml` | `owx setup` generated blocks + user edits | Setup refreshes OWX-managed blocks while preserving supported manual content; setup-owned runtime feature flags include `multi_agent`, `child_agents_md`, the Codex hook feature flag (`hooks` or legacy `codex_hooks`), and `goals`. |
| `~/.codex/hooks.json` / `./.codex/hooks.json` | `owx setup` shared ownership | Setup owns OWX native hook wrappers and preserves user-owned hooks. |
| prompts, skills, native agents | `owx setup` or Codex plugin delivery | Legacy mode installs local files; plugin mode relies on plugin discovery for bundled skills, archives/removes legacy OWX-managed prompt/skill copies, and refreshes setup-owned native agent TOMLs for `agent_type` routing while cleaning up stale generated/non-installable native agents. |
| `AGENTS.md` | `owx setup` with overwrite safety | Generated defaults or managed refreshes are guarded by force/session checks. |
| `./.owx/hud-config.json` | `owx setup` / `$hud` | Setup creates the focused default; `$hud` can adjust it later. |
| notification hooks | `owx setup` / `$configure-notifications` | Setup wires defaults outside plugin skill delivery; notification skill owns deeper provider configuration. |

## If `$owx-setup` is missing or stale

The source repo ships `skills/owx-setup/SKILL.md` and the catalog marks it active. If Codex does not show `$owx-setup`, treat it as an installation/discovery issue rather than a missing source skill:

1. Run `owx setup --verbose` in the intended scope.
2. Run `owx doctor` and check the reported setup scope, Codex home, skill root, and hook/config status.
3. If using project scope, confirm `./.codex/skills/owx-setup/SKILL.md` exists.
4. If using user scope, confirm `${CODEX_HOME:-~/.codex}/skills/owx-setup/SKILL.md` exists in legacy mode, or that the owen-codex plugin is installed/discovered in plugin mode.
5. If duplicate/stale skills appear, check for legacy `~/.agents/skills` overlap and follow the cleanup hint printed by setup/doctor.

## Recommended workflow

1. Run setup:

```bash
owx setup --force --verbose
```

2. Verify installation:

```bash
owx doctor
```

3. Start Codex with OWX in the target project directory.

## Expected verification indicators

From `owx doctor`, expect:
- Prompts installed (scope-dependent: user or project)
- Skills installed (scope-dependent: user or project)
- AGENTS.md found in project root
- `.owx/state` exists
- CLI-first config present in the scope target `config.toml`; first-party OWX MCP servers and shared MCP registry sync are omitted by default unless setup was run with `--mcp compat`

## Troubleshooting

- If using local source changes, run build first:

```bash
npm run build
```

- If your global `owx` points to another install, run local entrypoint:

```bash
node bin/owx.js setup --force --verbose
node bin/owx.js doctor
```

- If AGENTS.md was not overwritten during `--force`, stop active OWX session and rerun setup.
- If AGENTS.md was not merged during `--merge-agents`, stop active OWX session and rerun setup.
