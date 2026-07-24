---
name: "hud"
description: "Show or configure the OWX HUD (two-layer statusline)"
role: "display"
scope: ".owx/**"
---

# HUD Skill

The OWX HUD uses a two-layer architecture:

1. **Layer 1 - Codex built-in statusLine**: Real-time TUI footer showing model, git branch, and context usage. Configured via `[tui] status_line` in `~/.codex/config.toml`. Zero code required.

2. **Layer 2 - `owx hud` CLI command**: Shows OWX-specific orchestration state (ralph, ultrawork, autopilot, pipeline, ecomode, turns). Reads `.owx/state/` files.

## Quick Commands

| Command | Description |
|---------|-------------|
| `owx hud` | Show current HUD (modes, turns, activity) |
| `owx hud --watch` | Live-updating display (polls every 1s) |
| `owx hud --json` | Raw state output for scripting |
| `owx hud --preset=minimal` | Minimal display |
| `owx hud --preset=focused` | Default display |
| `owx hud --preset=full` | All elements |

## Presets

### minimal
```
[OWX] ralph:3/10 | turns:42
```

### focused (default)
```
[OWX] ralph:3/10 | ultrawork | turns:42 | last:5s ago
```

### full
```
[OWX] ralph:3/10 | ultrawork | autopilot:execution | pipeline:exec | turns:42 | last:5s ago | total-turns:156
```

## Setup

`owx setup` automatically configures both layers:
- Adds `[tui] status_line` to `~/.codex/config.toml` (Layer 1)
- Writes `.owx/hud-config.json` with default preset (Layer 2)
- Default preset is `focused`; if HUD/statusline changes do not appear, restart Codex CLI once.

## Layer 1: Codex Built-in StatusLine

Configured in `~/.codex/config.toml`:
```toml
[tui]
status_line = ["model-with-reasoning", "git-branch", "context-remaining"]
```

Available built-in items (Codex CLI v0.101.0+):
`model-name`, `model-with-reasoning`, `current-dir`, `project-root`, `git-branch`, `context-remaining`, `context-used`, `five-hour-limit`, `weekly-limit`, `codex-version`, `context-window-size`, `used-tokens`, `total-input-tokens`, `total-output-tokens`, `session-id`

## Layer 2: OWX Orchestration HUD

The `owx hud` command reads these state files:
- `.owx/state/ralph-state.json` - Ralph loop iteration
- `.owx/state/ultrawork-state.json` - Ultrawork mode
- `.owx/state/autopilot-state.json` - Autopilot phase
- `.owx/state/pipeline-state.json` - Pipeline stage
- `.owx/state/ecomode-state.json` - Ecomode active
- `.owx/state/hud-state.json` - Last activity (from notify hook)
- `.owx/metrics.json` - Turn counts

## Configuration

HUD config stored at `.owx/hud-config.json`:
```json
{
  "preset": "focused"
}
```

## Color Coding

- **Green**: Normal/healthy
- **Yellow**: Warning (ralph >70% of max)
- **Red**: Critical (ralph >90% of max)

## Troubleshooting

If the TUI statusline is not showing:
1. Ensure Codex CLI v0.101.0+ is installed
2. Run `owx setup` to configure `[tui]` section
3. Restart Codex CLI

If `owx hud` shows "No active modes":
- This is expected when no workflows are running
- Start a workflow (ralph, autopilot, etc.) and check again
