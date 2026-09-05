---
name: configure-notifications
description: Configure OWX notifications - unified entry point for all platforms
triggers:
  - "configure notifications"
  - "setup notifications"
  - "notification settings"
  - "configure discord"
  - "configure telegram"
  - "configure slack"
  - "configure openclaw"
  - "setup discord"
  - "setup telegram"
  - "setup slack"
  - "setup openclaw"
  - "discord notifications"
  - "telegram notifications"
  - "slack notifications"
  - "openclaw notifications"
  - "discord webhook"
  - "telegram bot"
  - "slack webhook"
---

# Configure OWX Notifications

Unified and only entry point for notification setup.

- **Native integrations (first-class):** Discord, Telegram, Slack
- **Generic extensibility integrations:** `custom_webhook_command`, `custom_cli_command`

> Standalone configure skills (`configure-discord`, `configure-telegram`, `configure-slack`, `configure-openclaw`) are removed.

## Step 1: Inspect Current State

```bash
CONFIG_FILE="$HOME/.codex/.owx-config.json"

if [ -f "$CONFIG_FILE" ]; then
  jq -r '
    {
      notifications_enabled: (.notifications.enabled // false),
      discord: (.notifications.discord.enabled // false),
      discord_bot: (.notifications["discord-bot"].enabled // false),
      telegram: (.notifications.telegram.enabled // false),
      slack: (.notifications.slack.enabled // false),
      openclaw: (.notifications.openclaw.enabled // false),
      custom_webhook_command: (.notifications.custom_webhook_command.enabled // false),
      custom_cli_command: (.notifications.custom_cli_command.enabled // false),
      verbosity: (.notifications.verbosity // "session"),
      idleCooldownSeconds: (.notifications.idleCooldownSeconds // 60)
    }
  ' "$CONFIG_FILE"
else
  echo "NO_CONFIG_FILE"
fi
```

## Step 2: Main Menu

Use AskUserQuestion:

**Question:** "What would you like to configure?"

**Options:**
1. **Discord (native)** - webhook or bot
2. **Telegram (native)** - bot token + chat id
3. **Slack (native)** - incoming webhook
4. **Generic webhook command** - `custom_webhook_command`
5. **Generic CLI command** - `custom_cli_command`
6. **Cross-cutting settings** - verbosity, idle cooldown, profiles
7. **Disable all notifications** - set `notifications.enabled = false`

## Step 3: Configure Native Platforms (Discord / Telegram / Slack)

Collect and validate platform-specific values, then write directly under native keys:

- Discord webhook: `notifications.discord`
- Discord bot: `notifications["discord-bot"]`
- Telegram: `notifications.telegram`
- Slack: `notifications.slack`

Do not write these as generic command/webhook aliases.

## Step 4: Configure Generic Extensibility

### 4a) `custom_webhook_command`

Use AskUserQuestion to collect:
- URL
- Optional headers
- Optional method (`POST` default, or `PUT`)
- Optional event list (`session-end`, `ask-user-question`, `session-start`, `session-idle`, `stop`)
- Optional instruction template

Encode collected events as a JSON array in `EVENTS_JSON`; use `["session-end","ask-user-question"]` only when omitted. An explicit empty or invalid event list is an error. Set `INSTRUCTION` only when supplied; the example supplies the default when unset.

Encode supplied headers as a string-valued JSON object in `HEADERS_JSON`; use `{}` when omitted. Do not print secret header values.

Write to an existing valid config (create `{}` first only if the config file does not exist). Validation failures leave the original file intact; stop and report the error.

```bash
set -e
if [ "${EVENTS_JSON+x}" != x ]; then EVENTS_JSON='["session-end","ask-user-question"]'; fi
if [ "${HEADERS_JSON+x}" != x ]; then HEADERS_JSON='{}'; fi
if [ "${INSTRUCTION+x}" != x ]; then INSTRUCTION='OWX event {{event}} for {{projectPath}}'; fi
CONFIG_TMP=$(mktemp "${CONFIG_FILE}.XXXXXX")
trap 'rm -f "$CONFIG_TMP"' EXIT
jq -e \
  --arg url "$URL" \
  --arg method "${METHOD:-POST}" \
  --argjson headers "$HEADERS_JSON" \
  --argjson events "$EVENTS_JSON" \
  --arg instruction "$INSTRUCTION" \
  'if type != "object" then error("config must be an object") else . end |
   if ($events | type) != "array" then error("events must be an array")
   elif ($events | length) == 0 then error("events must not be empty")
   elif ($events | all(. == "session-end" or . == "ask-user-question" or . == "session-start" or . == "session-idle" or . == "stop") | not)
   then error("unsupported event") else . end |
   if ($headers | type) != "object" then error("headers must be an object")
   elif ($headers | all(.[]; type == "string") | not) then error("header values must be strings") else . end |
   if ($method != "POST" and $method != "PUT") then error("method must be POST or PUT") else . end |
   if ($url | test("^https?://[^/[:space:]]+" ) | not) then error("URL must be HTTP(S)") else . end |
   .notifications = (.notifications // {}) |
   .notifications.enabled = true |
   .notifications.custom_webhook_command = {
     enabled: true,
     url: $url,
     method: $method,
     headers: $headers,
     instruction: $instruction,
     events: $events
   }' "$CONFIG_FILE" > "$CONFIG_TMP"
mv "$CONFIG_TMP" "$CONFIG_FILE"
trap - EXIT
```

### 4b) `custom_cli_command`

Collect the command template (supports `{{event}}`, `{{instruction}}`, `{{sessionId}}`, `{{projectPath}}`), optional event list, and optional instruction template.

Encode collected events as a JSON array in `EVENTS_JSON`; use `["session-end","ask-user-question"]` only when omitted. An explicit empty or invalid event list is an error. Set `INSTRUCTION` only when supplied; the example supplies the default when unset.

Write to an existing valid config (create `{}` first only if the config file does not exist). Validation failures leave the original file intact; stop and report the error.

```bash
set -e
if [ "${EVENTS_JSON+x}" != x ]; then EVENTS_JSON='["session-end","ask-user-question"]'; fi
if [ "${INSTRUCTION+x}" != x ]; then INSTRUCTION='OWX event {{event}} for {{projectPath}}'; fi
CONFIG_TMP=$(mktemp "${CONFIG_FILE}.XXXXXX")
trap 'rm -f "$CONFIG_TMP"' EXIT
jq -e \
  --arg command "$COMMAND_TEMPLATE" \
  --argjson events "$EVENTS_JSON" \
  --arg instruction "$INSTRUCTION" \
  'if type != "object" then error("config must be an object") else . end |
   if ($events | type) != "array" then error("events must be an array")
   elif ($events | length) == 0 then error("events must not be empty")
   elif ($events | all(. == "session-end" or . == "ask-user-question" or . == "session-start" or . == "session-idle" or . == "stop") | not)
   then error("unsupported event") else . end |
   if ($command | test("[^[:space:]]") | not) then error("command must not be empty") else . end |
   .notifications = (.notifications // {}) |
   .notifications.enabled = true |
   .notifications.custom_cli_command = {
     enabled: true,
     command: $command,
     instruction: $instruction,
     events: $events
   }' "$CONFIG_FILE" > "$CONFIG_TMP"
mv "$CONFIG_TMP" "$CONFIG_FILE"
trap - EXIT
```

> Activation gate: OpenClaw-backed dispatch is active only when `OWX_OPENCLAW=1`.
> For command gateways, also require `OWX_OPENCLAW_COMMAND=1`.
> Optional timeout env override: `OWX_OPENCLAW_COMMAND_TIMEOUT_MS` (ms).

### 4b-1) OpenClaw + Clawdbot Agent Workflow (recommended for dev)

If the user explicitly asks to route hook notifications through **clawdbot agent turns**
(not direct message/webhook forwarding), use a command gateway that invokes
`clawdbot agent` and delivers back to Discord.

Notes:
- Hook name mapping is intentional: notifications `session-stop` -> OpenClaw hook `stop`.
- OWX shell-escapes template substitutions for command gateways (including `{{instruction}}`).
- Keep `instruction` templates concise and avoid untrusted shell metacharacters.
- During troubleshooting, avoid swallowing command output; route it to a log file.
- Timeout precedence: `gateways.<name>.timeout` > `OWX_OPENCLAW_COMMAND_TIMEOUT_MS` > `5000`.
- For clawdbot agent workflows, set `gateways.<name>.timeout` to `120000` (recommended).
- For dev operations, enforce Korean output in all hook instructions.
- Include `session={{sessionId}}` in hook text for traceability.
- If follow-up is needed, explicitly instruct clawdbot to consult `SOUL.md` and continue in `#omc-dev`.
- **Error handling**: Append `|| true` to prevent OWX hook failures from blocking the session.
- **JSONL logging**: Use `.jsonl` extension and append (`>>`) for structured log aggregation.
- **Reply target format**: Use `--reply-to 'channel:CHANNEL_ID'` for reliability (preferred over channel aliases).

Example (targeting `#omc-dev` with production-tested settings):

```bash
jq \
  --arg command "(clawdbot agent --session-id owx-hooks --message {{instruction}} --thinking minimal --deliver --reply-channel discord --reply-to 'channel:1468539002985644084' --timeout 120 --json >>/tmp/owx-openclaw-agent.jsonl 2>&1 || true)" \
  '.notifications = (.notifications // {enabled: true}) |
   .notifications.enabled = true |
   .notifications.verbosity = "verbose" |
   .notifications.events = (.notifications.events // {}) |
   .notifications.events["session-start"] = {enabled: true} |
   .notifications.events["session-idle"] = {enabled: true} |
   .notifications.events["ask-user-question"] = {enabled: true} |
   .notifications.events["session-stop"] = {enabled: true} |
   .notifications.events["session-end"] = {enabled: true} |
   .notifications.openclaw = (.notifications.openclaw // {}) |
   .notifications.openclaw.enabled = true |
   .notifications.openclaw.gateways = (.notifications.openclaw.gateways // {}) |
   .notifications.openclaw.gateways["local"] = {
     type: "command",
     command: $command,
     timeout: 120000
   } |
   .notifications.openclaw.hooks = (.notifications.openclaw.hooks // {}) |
   .notifications.openclaw.hooks["session-start"] = {
     enabled: true,
     gateway: "local",
     instruction: "OWX hook=session-start project={{projectName}} session={{sessionId}}. 한국어로 상태를 공유하고 SOUL.md를 참고해 필요한 후속 조치를 #omc-dev에 안내하세요."
   } |
   .notifications.openclaw.hooks["session-idle"] = {
     enabled: true,
     gateway: "local",
     instruction: "OWX hook=session-idle project={{projectName}} session={{sessionId}}. 한국어로 idle 상황을 간단히 공유하고 진행중인 작업 팔로업을 안내하세요."
   } |
   .notifications.openclaw.hooks["ask-user-question"] = {
     enabled: true,
     gateway: "local",
     instruction: "OWX hook=ask-user-question session={{sessionId}} question={{question}}. 한국어로 사용자 응답 필요를 #omc-dev에 알리고 즉시 액션 아이템을 제시하세요."
   } |
   .notifications.openclaw.hooks["stop"] = {
     enabled: true,
     gateway: "local",
     instruction: "OWX hook=session-stop project={{projectName}} session={{sessionId}}. 한국어로 중단 상태와 정리 액션을 SOUL.md 기준으로 전달하세요."
   } |
   .notifications.openclaw.hooks["session-end"] = {
     enabled: true,
     gateway: "local",
     instruction: "OWX hook=session-end project={{projectName}} session={{sessionId}} reason={{reason}}. 한국어로 완료 요약을 1줄로 남기고 필요한 후속 조치를 안내하세요."
   }' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
```

Verification for this mode:

```bash
clawdbot agent --session-id owx-hooks --message "OWX hook test via clawdbot agent path" \
  --thinking minimal --deliver --reply-channel discord --reply-to 'channel:1468539002985644084' --timeout 120 --json
```

Dev runbook (Korean follow-up):

```bash
# confirm hook templates include session context
jq '.notifications.openclaw.hooks' "$CONFIG_FILE"

# 3) inspect agent JSONL logs when delivery looks broken
tail -n 120 /tmp/owx-openclaw-agent.jsonl | jq -s '.[] | {timestamp: (.timestamp // .time), status: (.status // .error // "ok")}'

# 4) check for recent errors in logs
rg '"error"|"failed"|"timeout"' /tmp/owx-openclaw-agent.jsonl | tail -20
```

### 4c) Compatibility + precedence contract

OWX accepts both:
- explicit `notifications.openclaw` schema (legacy/runtime shape)
- generic aliases (`custom_webhook_command`, `custom_cli_command`)

Deterministic precedence:
1. `notifications.openclaw` **wins** when present and valid.
2. Generic aliases are ignored in that case (with warning).

## Step 5: Cross-Cutting Settings

### Verbosity
- minimal / session (recommended) / agent / verbose

### Idle cooldown
- `notifications.idleCooldownSeconds`

### Profiles
- `notifications.profiles`
- `notifications.defaultProfile`

## Step 6: Disable All Notifications

```bash
jq '.notifications.enabled = false' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
```

## Step 7: Verification Guidance

After writing config, validate its JSON with `jq -e . "$CONFIG_FILE"` and compare the saved non-secret values against the requested settings. Confirm headers are preserved without printing credentials. A repository build does not validate a user configuration. Send a delivery test only when the user has authorized that external message; report configuration validation separately from delivery verification.

For OpenClaw-like HTTP integrations, verify both:
- `/hooks/wake` smoke test
- `/hooks/agent` delivery verification

## Final Summary Template

Show:
- Native platforms enabled
- Generic aliases enabled (`custom_webhook_command`, `custom_cli_command`)
- Whether explicit `notifications.openclaw` exists (and therefore overrides aliases)
- Verbosity + idle cooldown
- Config path (`~/.codex/.owx-config.json`)
