#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// sync-plugin-mirror verifies this stable marker; runtime behavior is tested separately.
const OWX_PLUGIN_HOOK_STANDALONE_CONTRACT_MARKER = 'owx-plugin-hook-standalone:v1';
const MAX_STDIN_BYTES = 1024 * 1024;
const RAW_EVENT_SCAN_BYTES = 64 * 1024;
const CODEX_HOOK_EVENT_NAMES = new Set([
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'PreCompact',
  'PostCompact',
  'Stop',
]);
const MODE_STATE_FILES = [
  'autopilot-state.json',
  'autoresearch-state.json',
  'deep-interview-state.json',
  'ralph-state.json',
  'ralplan-state.json',
  'ultragoal-state.json',
  'ultraqa-state.json',
  'ultrawork-state.json',
];
const RETAINED_WORKFLOW_SKILLS = new Map([
  ['autopilot', 'autopilot'],
  ['autoresearch', 'autoresearch'],
  ['deep-interview', 'deep-interview'],
  ['ralph', 'ralph'],
  ['ralplan', 'ralplan'],
  ['ultragoal', 'ultragoal'],
  ['ultraqa', 'ultraqa'],
  ['ultrawork', 'ultrawork'],
]);
const IMPLEMENTATION_TOOL_NAMES = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'ApplyPatch',
]);
const EXECUTION_HANDOFF_SKILLS = new Set([
  'autoresearch', 'ralph', 'ultragoal', 'ultrawork', 'ultraqa',
]);
const WORKFLOW_ALLOWED_PATHS = {
  'deep-interview': ['.owx/context', '.owx/interviews', '.owx/specs'],
  ralplan: ['.owx/context', '.owx/plans', '.owx/specs', '.owx/drafts'],
};
const TERMINAL_VALUES = new Set([
  'finish', 'finished', 'complete', 'completed', 'done',
  'blocked', 'blocked-on-user', 'blocked_on_user',
  'failed', 'fail', 'error', 'cancelled', 'canceled', 'cancel',
  'aborted', 'abort', 'userinterlude', 'user-interlude',
  'interrupted', 'interrupt', 'askuserquestion', 'ask-user-question',
  'askuser', 'question',
]);

function skipJsonWhitespace(raw, index) {
  while (index < raw.length && /\s/.test(raw[index] ?? '')) index += 1;
  return index;
}

function readJsonStringLiteral(raw, quoteIndex) {
  if (raw[quoteIndex] !== '"') return null;
  let value = '';
  for (let index = quoteIndex + 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') return { value, endIndex: index + 1 };
    if (char !== '\\') {
      value += char;
      continue;
    }
    index += 1;
    if (index >= raw.length) return null;
    const escaped = raw[index];
    if ('"\\/'.includes(escaped)) value += escaped;
    else if (escaped === 'b') value += '\b';
    else if (escaped === 'f') value += '\f';
    else if (escaped === 'n') value += '\n';
    else if (escaped === 'r') value += '\r';
    else if (escaped === 't') value += '\t';
    else if (escaped === 'u') {
      const hex = raw.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    } else return null;
  }
  return null;
}

function extractTopLevelStringField(rawInput, fieldNames) {
  const raw = rawInput.slice(0, RAW_EVENT_SCAN_BYTES);
  const wanted = new Set(fieldNames);
  let depth = 0;
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (char === '"') {
      const key = readJsonStringLiteral(raw, index);
      if (!key) return null;
      index = key.endIndex;
      const afterKey = skipJsonWhitespace(raw, index);
      if (depth === 1 && raw[afterKey] === ':' && wanted.has(key.value)) {
        return readJsonStringLiteral(raw, skipJsonWhitespace(raw, afterKey + 1))?.value ?? null;
      }
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    index += 1;
  }
  return null;
}

// Missing or malformed state cannot authoritatively prove that Stop must block.
function readOptionalStateFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function canonicalPath(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return absolute;
  try {
    return typeof realpathSync.native === 'function' ? realpathSync.native(absolute) : realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function isSafeSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.trim());
}

function isTerminal(value) {
  return TERMINAL_VALUES.has(String(value ?? '').trim().toLowerCase());
}

function isActiveState(state) {
  if (!state || state.active !== true) return false;
  if (typeof state.completed_at === 'string' && state.completed_at.trim()) return false;
  return ![
    state.current_phase,
    state.outcome,
    state.run_outcome,
    state.lifecycle_outcome,
    state.terminal_outcome,
  ].some(isTerminal);
}

function stateDirForCwd(cwd) {
  if (process.env.OWX_ROOT?.trim()) return join(process.env.OWX_ROOT.trim(), '.owx', 'state');
  if (process.env.OWX_STATE_ROOT?.trim()) return join(process.env.OWX_STATE_ROOT.trim(), '.owx', 'state');
  return join(cwd, '.owx', 'state');
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function payloadCwd(payload) {
  return safeString(payload?.cwd) || process.cwd();
}

function payloadSessionId(payload) {
  const value = safeString(payload?.session_id ?? payload?.sessionId);
  return isSafeSessionId(value) ? value : '';
}

function payloadThreadId(payload) {
  return safeString(payload?.thread_id ?? payload?.threadId);
}

function payloadTurnId(payload) {
  return safeString(payload?.turn_id ?? payload?.turnId);
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function appendJsonLine(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function readBoundedFirstLine(path) {
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytesRead).split(/\r?\n/, 1)[0] ?? '';
  } finally {
    closeSync(descriptor);
  }
}

function readNativeSubagentMetadata(payload) {
  const transcriptPath = safeString(payload?.transcript_path ?? payload?.transcriptPath);
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  try {
    const record = safeObject(JSON.parse(readBoundedFirstLine(transcriptPath)));
    if (record.type !== 'session_meta') return null;
    const sessionPayload = safeObject(record.payload);
    const spawn = safeObject(safeObject(safeObject(sessionPayload.source).subagent).thread_spawn);
    const parentThreadId = safeString(spawn.parent_thread_id);
    if (!parentThreadId) return null;
    return {
      parentThreadId,
      role: safeString(
        spawn.agent_role ?? spawn.agentRole ?? spawn.agent_type ?? spawn.agentType
          ?? sessionPayload.agent_role ?? sessionPayload.agentRole
          ?? sessionPayload.agent_type ?? sessionPayload.agentType,
      ).toLowerCase(),
    };
  } catch {
    return null;
  }
}

function readCurrentSession(cwd) {
  const current = readOptionalStateFile(join(stateDirForCwd(cwd), 'session.json'));
  if (!isSafeSessionId(current?.session_id)) return null;
  if (safeString(current.cwd) && canonicalPath(current.cwd) !== canonicalPath(cwd)) return null;
  return current;
}

function writeSessionObservation(payload) {
  const cwd = payloadCwd(payload);
  const sessionId = payloadSessionId(payload);
  if (!sessionId) return null;
  const now = new Date().toISOString();
  const existing = readCurrentSession(cwd);
  const state = {
    version: 1,
    session_id: sessionId,
    native_session_id: sessionId,
    cwd,
    pid: process.pid,
    platform: process.platform,
    started_at: existing?.session_id === sessionId && safeString(existing.started_at)
      ? existing.started_at
      : now,
    updated_at: now,
  };
  writeJsonAtomic(join(stateDirForCwd(cwd), 'session.json'), state);
  return state;
}

function resolveSessionObservation(payload) {
  const cwd = payloadCwd(payload);
  const current = readCurrentSession(cwd);
  const requested = payloadSessionId(payload);
  if (current && (!requested || current.session_id === requested)) return current;
  return requested ? writeSessionObservation(payload) : null;
}

function recordTrackedThread(cwd, sessionId, input) {
  const path = join(stateDirForCwd(cwd), 'subagent-tracking.json');
  const state = readOptionalStateFile(path);
  const tracking = state?.schemaVersion === 1 && safeObject(state.sessions) === state.sessions
    ? state
    : { schemaVersion: 1, sessions: {} };
  const sessions = safeObject(tracking.sessions);
  const now = new Date().toISOString();
  const existingSession = safeObject(sessions[sessionId]);
  const threads = safeObject(existingSession.threads);
  const existingThread = safeObject(threads[input.threadId]);
  threads[input.threadId] = {
    ...existingThread,
    thread_id: input.threadId,
    kind: input.kind,
    first_seen_at: safeString(existingThread.first_seen_at) || now,
    last_seen_at: now,
    turn_count: Number.isInteger(existingThread.turn_count) ? existingThread.turn_count + 1 : 1,
    ...(input.turnId ? { last_turn_id: input.turnId } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.provenanceKind ? { provenance_kind: input.provenanceKind } : {}),
    ...(input.completed ? { completed_at: now, status: 'closed', completion_source: input.completionSource } : {}),
  };
  sessions[sessionId] = {
    ...existingSession,
    session_id: sessionId,
    ...(input.kind === 'leader' ? { leader_thread_id: input.threadId, leader_attested_at: now } : {}),
    updated_at: now,
    threads,
  };
  tracking.sessions = sessions;
  writeJsonAtomic(path, tracking);
}

function recordSessionStart(payload) {
  const cwd = payloadCwd(payload);
  const childMetadata = readNativeSubagentMetadata(payload);
  const childSessionId = payloadSessionId(payload);
  if (childMetadata && childSessionId) {
    const current = readCurrentSession(cwd);
    const tracking = current
      ? readOptionalStateFile(join(stateDirForCwd(cwd), 'subagent-tracking.json'))
      : null;
    const trackedSession = current ? safeObject(tracking?.sessions?.[current.session_id]) : {};
    const trackedLeader = safeObject(trackedSession.threads?.[childMetadata.parentThreadId]);
    if (
      current
      && trackedSession.leader_thread_id === childMetadata.parentThreadId
      && trackedLeader.kind === 'leader'
    ) {
      recordTrackedThread(cwd, current.session_id, {
        threadId: childSessionId,
        kind: 'subagent',
        role: childMetadata.role,
        provenanceKind: 'native_session_start',
      });
      return current;
    }
  }
  const session = writeSessionObservation(payload);
  const threadId = payloadThreadId(payload);
  if (session && threadId) {
    recordTrackedThread(cwd, session.session_id, {
      threadId,
      kind: 'leader',
      provenanceKind: 'native_session_start',
    });
  }
  return session;
}

function recordPostToolUse(payload, session) {
  if (!session) return;
  const cwd = payloadCwd(payload);
  const toolName = safeString(payload.tool_name ?? payload.toolName);
  const toolInput = safeObject(payload.tool_input ?? payload.toolInput);
  const toolResponse = safeObject(payload.tool_response ?? payload.toolResponse ?? payload.result);
  const threadId = safeString(
    toolResponse.thread_id ?? toolResponse.threadId ?? toolResponse.agent_id ?? toolResponse.agentId,
  );
  const isNativeAgentTool = /(?:^|\.)(?:spawn_agent|followup_task|wait_agent|interrupt_agent)$/.test(toolName);
  if (!isNativeAgentTool || !threadId) return;
  const status = safeString(toolResponse.status).toLowerCase();
  recordTrackedThread(cwd, session.session_id, {
    threadId,
    turnId: payloadTurnId(payload),
    kind: 'subagent',
    role: safeString(toolInput.agent_type ?? toolInput.agentType).toLowerCase(),
    provenanceKind: 'native_tool_result',
    completed: ['complete', 'completed', 'closed', 'failed', 'cancelled'].includes(status),
    completionSource: 'native_tool_result',
  });
}

function stringifyEvidence(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function nativeAgentEvidenceText(payload) {
  return [
    safeString(payload.tool_name ?? payload.toolName),
    stringifyEvidence(payload.tool_response ?? payload.toolResponse),
    stringifyEvidence(payload.response),
    stringifyEvidence(payload.error),
    stringifyEvidence(payload.message),
  ].filter(Boolean).join('\n');
}

function recordNativeAgentFailureEvidence(payload, session) {
  if (!session) return;
  const toolName = safeString(payload.tool_name ?? payload.toolName);
  if (toolName && !/(?:spawn_agent|multi_agent|subagent|collab|agent)/i.test(toolName)) return;
  const evidence = nativeAgentEvidenceText(payload);
  const cwd = payloadCwd(payload);
  const common = {
    schema_version: 1,
    session_id: session.session_id,
    ...(payloadThreadId(payload) ? { thread_id: payloadThreadId(payload) } : {}),
    ...(payloadTurnId(payload) ? { turn_id: payloadTurnId(payload) } : {}),
    ...(toolName ? { tool_name: toolName } : {}),
    observed_at: new Date().toISOString(),
    cwd,
  };
  const sessionDir = join(stateDirForCwd(cwd), 'sessions', session.session_id);
  if (/\bagent thread limit reached\b/i.test(evidence)) {
    const now = Date.now();
    writeJsonAtomic(join(sessionDir, 'native-subagent-capacity.json'), {
      ...common,
      status: 'unknown',
      reason: 'agent_thread_limit_reached',
      source: 'capacity_blocker',
      error_summary: evidence.replace(/\s+/g, ' ').trim().slice(0, 500),
      observed_at: new Date(now).toISOString(),
      expires_at: new Date(now + 5 * 60_000).toISOString(),
    });
    return;
  }
  let reason = null;
  if (/\bnative subagents? (?:unsupported|disabled|not enabled|unavailable|not found)\b/i.test(evidence)) {
    reason = 'native_subagents_unsupported';
  } else if (
    /\bmulti_agent_v1\b/i.test(evidence)
    && /\b(?:unavailable|unknown tool|disabled|not enabled|not found|unsupported)\b/i.test(evidence)
  ) {
    reason = 'multi_agent_v1_unavailable';
  }
  if (!reason) return;
  writeJsonAtomic(join(sessionDir, 'native-subagent-support.json'), {
    ...common,
    status: 'unsupported',
    reason,
    source: 'persisted_support_blocker',
    evidence_summary: evidence.replace(/\s+/g, ' ').trim().slice(0, 500),
  });
}

function activeSkillEntries(state) {
  if (Array.isArray(state?.active_skills)) {
    return state.active_skills.filter((entry) => entry?.active !== false && safeString(entry?.skill));
  }
  return state?.active === true && safeString(state.skill) ? [state] : [];
}

function stateMatchesSession(state, sessionId) {
  const owner = safeString(
    state?.owner_owx_session_id ?? state?.session_id
      ?? state?.codex_session_id ?? state?.owner_codex_session_id,
  );
  return !owner || owner === sessionId;
}

function hasTrustedNativeAgentProvenance(payload, session) {
  if (!session) return false;
  const threadId = payloadThreadId(payload);
  const sourceSpawn = safeObject(safeObject(safeObject(payload.source).subagent).thread_spawn);
  const role = safeString(
    payload.agent_role ?? payload.agentRole ?? payload.agent_type ?? payload.agentType
      ?? sourceSpawn.agent_role ?? sourceSpawn.agentRole ?? sourceSpawn.agent_type ?? sourceSpawn.agentType,
  ).toLowerCase();
  if (!threadId || !role) return false;
  const tracking = readOptionalStateFile(join(stateDirForCwd(payloadCwd(payload)), 'subagent-tracking.json'));
  const trackedSession = safeObject(tracking?.sessions?.[session.session_id]);
  const trackedThread = safeObject(trackedSession.threads?.[threadId]);
  return trackedSession.leader_thread_id !== threadId
    && trackedThread.kind === 'subagent'
    && safeString(trackedThread.role ?? trackedThread.mode).toLowerCase() === role;
}

function readActivePlanningMode(payload, session) {
  if (!session || hasTrustedNativeAgentProvenance(payload, session)) return null;
  const sessionDir = join(stateDirForCwd(payloadCwd(payload)), 'sessions', session.session_id);
  const skillState = readOptionalStateFile(join(sessionDir, 'skill-active-state.json'));
  const skills = activeSkillEntries(skillState)
    .filter((entry) => stateMatchesSession(entry, session.session_id))
    .map((entry) => safeString(entry.skill));
  if (skills.some((skill) => EXECUTION_HANDOFF_SKILLS.has(skill))) return null;
  for (const mode of ['deep-interview', 'ralplan']) {
    if (!skills.includes(mode)) continue;
    const modeState = readOptionalStateFile(join(sessionDir, `${mode}-state.json`));
    if (!isActiveState(modeState) || !stateMatchesSession(modeState, session.session_id)) continue;
    if (safeString(modeState.mode) && safeString(modeState.mode) !== mode) continue;
    return { mode, state: modeState };
  }
  if (skills.includes('autopilot')) {
    const autopilotState = readOptionalStateFile(join(sessionDir, 'autopilot-state.json'));
    const phase = safeString(autopilotState?.current_phase ?? autopilotState?.currentPhase).toLowerCase();
    if (
      isActiveState(autopilotState)
      && stateMatchesSession(autopilotState, session.session_id)
      && (!safeString(autopilotState.mode) || safeString(autopilotState.mode) === 'autopilot')
      && /^(?:ralplan|replan|planning)$/.test(phase)
    ) return { mode: 'ralplan', state: autopilotState };
  }
  return null;
}

function extractPatchTargets(text) {
  const targets = [];
  for (const match of text.matchAll(/^\s*\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$/gm)) {
    targets.push(safeString(match[1]));
  }
  for (const match of text.matchAll(/^\s*\*\*\*\s+Move\s+to:\s*(.+?)\s*$/gm)) {
    targets.push(safeString(match[1]));
  }
  return targets.filter(Boolean);
}

function planningToolPaths(payload, toolName) {
  const input = safeObject(payload.tool_input ?? payload.toolInput);
  const paths = [input.file_path, input.filePath, input.path, input.target_path, input.targetPath]
    .map(safeString)
    .filter(Boolean);
  if (toolName === 'apply_patch' || toolName === 'ApplyPatch') {
    paths.push(...extractPatchTargets(safeString(input.input ?? input.patch ?? input.content ?? input.text)));
  }
  return paths;
}

function isAllowedPlanningPath(cwd, rawPath, mode) {
  const trimmed = safeString(rawPath).replace(/^['"]|['"]$/g, '');
  if (!trimmed || isAbsolute(trimmed) || trimmed.includes('\0') || trimmed.split(/[\\/]/).includes('..')) return false;
  const relativePath = relative(cwd, resolve(cwd, trimmed)).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('../')) return false;
  let existingPath = cwd;
  for (const segment of relativePath.split('/')) {
    existingPath = join(existingPath, segment);
    const stats = lstatSync(existingPath, { throwIfNoEntry: false });
    if (!stats) break;
    if (stats.isSymbolicLink() || (stats.isFile() && stats.nlink > 1)) return false;
  }
  if (mode === 'ralplan' && relativePath.startsWith('.owx/drafts/')) {
    return /^\.owx\/drafts\/[^/]+\.md$/.test(relativePath);
  }
  return WORKFLOW_ALLOWED_PATHS[mode].some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  );
}

function isReadOnlyPlanningCommand(command) {
  if (
    !command
    || /[$`()<>]|\b(?:eval|exec|source)\b/.test(command)
    || command.replaceAll('&&', '').includes('&')
  ) return false;
  const simpleCommands = command.split(/(?:&&|\|\||[;|\n])/).map((part) => part.trim()).filter(Boolean);
  if (simpleCommands.length === 0) return false;
  return simpleCommands.every((simple) => {
    if (/^(?:env\s|[A-Za-z_][A-Za-z0-9_]*=)/.test(simple)) return false;
    const normalized = simple.replace(/^(?:command\s+)+/, '');
    const executable = normalized.match(/^([A-Za-z][A-Za-z0-9_-]*|\[)(?=\s|$)/)?.[1];
    if (!executable) return false;
    const name = executable;
    if (['pwd', 'ls', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'wc', 'cut', 'tr', 'jq', 'stat', 'realpath', 'readlink', 'diff', 'which', 'type', 'true', 'false', 'test', '[', 'echo'].includes(name)) {
      return true;
    }
    return false;
  });
}

function buildPlanningBoundaryOutput(payload, session) {
  const active = readActivePlanningMode(payload, session);
  if (!active) return null;
  const toolName = safeString(payload.tool_name ?? payload.toolName);
  const input = safeObject(payload.tool_input ?? payload.toolInput);
  let blocked = false;
  if (toolName === 'Bash') {
    blocked = !isReadOnlyPlanningCommand(safeString(input.command));
  } else if (IMPLEMENTATION_TOOL_NAMES.has(toolName)) {
    const paths = planningToolPaths(payload, toolName);
    blocked = paths.length === 0 || !paths.every((path) => isAllowedPlanningPath(payloadCwd(payload), path, active.mode));
  }
  if (!blocked) return null;
  const phase = safeString(active.state.current_phase ?? active.state.currentPhase) || 'planning';
  const label = active.mode === 'ralplan' ? 'Ralplan' : 'Deep-interview';
  return {
    decision: 'block',
    reason: `${label} is active (phase: ${phase}); implementation/write tools are blocked until an explicit execution handoff workflow is activated.`,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: active.mode === 'ralplan'
        ? 'Ralplan is consensus-planning mode. Write only planning artifacts under .owx/context, .owx/plans, .owx/specs, or direct Markdown drafts under .owx/drafts. Activate an explicit execution handoff before editing implementation files.'
        : 'Deep-interview is requirements/spec mode. Write only interview and specification artifacts under .owx/context, .owx/interviews, or .owx/specs. Activate an explicit execution handoff before implementation.',
    },
  };
}

function explicitWorkflowFromPrompt(payload) {
  const prompt = safeString(
    payload.prompt ?? payload.user_prompt ?? payload.userPrompt ?? payload.input,
  );
  for (const [token, skill] of RETAINED_WORKFLOW_SKILLS) {
    const pattern = new RegExp(`(?:^|\\s)[$/]${token}(?=\\s|$|[.,!?;:])`, 'i');
    if (pattern.test(prompt)) return skill;
  }
  return null;
}

function recordWorkflowActivation(payload, session) {
  const skill = explicitWorkflowFromPrompt(payload);
  if (!skill || !session) return null;
  const cwd = payloadCwd(payload);
  const now = new Date().toISOString();
  const threadId = payloadThreadId(payload);
  const path = join(stateDirForCwd(cwd), 'sessions', session.session_id, 'skill-active-state.json');
  const existing = readOptionalStateFile(path) ?? {};
  const existingEntries = Array.isArray(existing.active_skills) ? existing.active_skills : [];
  const retainedEntries = existingEntries.filter((entry) => safeString(entry?.skill) !== skill);
  const entry = {
    skill,
    phase: 'activated',
    active: true,
    activated_at: now,
    updated_at: now,
    session_id: session.session_id,
    ...(threadId ? { thread_id: threadId } : {}),
  };
  writeJsonAtomic(path, {
    ...existing,
    version: 1,
    active: true,
    skill,
    phase: 'activated',
    source: 'plugin-user-prompt-submit',
    session_id: session.session_id,
    updated_at: now,
    active_skills: [...retainedEntries, entry],
  });
  return skill;
}

function lifecycleLogPath(cwd) {
  return join(dirname(stateDirForCwd(cwd)), 'logs', `native-hooks-${new Date().toISOString().slice(0, 10)}.jsonl`);
}

function recordLifecycleEvent(eventName, payload, session, details = {}) {
  const cwd = payloadCwd(payload);
  appendJsonLine(lifecycleLogPath(cwd), {
    timestamp: new Date().toISOString(),
    event: eventName,
    cwd,
    ...(session?.session_id ? { session_id: session.session_id } : {}),
    ...(payloadThreadId(payload) ? { thread_id: payloadThreadId(payload) } : {}),
    ...(payloadTurnId(payload) ? { turn_id: payloadTurnId(payload) } : {}),
    ...(safeString(payload.tool_name ?? payload.toolName)
      ? { tool_name: safeString(payload.tool_name ?? payload.toolName) }
      : {}),
    ...details,
  });
}

function hookPluginId(filename) {
  return basename(filename, '.mjs')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
}

function hookPluginEventName(eventName) {
  return {
    SessionStart: 'session-start',
    PreToolUse: 'pre-tool-use',
    PostToolUse: 'post-tool-use',
    UserPromptSubmit: 'keyword-detector',
    PreCompact: 'pre-compact',
    PostCompact: 'post-compact',
    Stop: 'stop',
  }[eventName];
}

function hookPluginTimeoutMs() {
  const rawTimeout = Number.parseInt(safeString(process.env.OWX_HOOK_PLUGIN_TIMEOUT_MS), 10);
  return Number.isFinite(rawTimeout) ? Math.min(60_000, Math.max(100, rawTimeout)) : 1_500;
}

function sanitizedHookPluginContext(eventName, payload, session) {
  const context = { ...payload };
  if (eventName === 'UserPromptSubmit') {
    for (const key of ['prompt', 'input', 'user_prompt', 'userPrompt', 'text']) delete context[key];
  }
  if (eventName === 'Stop') {
    delete context.stop_hook_active;
    delete context.stopHookActive;
    delete context.sessionId;
    context.session_id = session?.session_id || payloadSessionId(payload);
  }
  return context;
}

async function runProjectHookPlugin(request) {
  const runnerPath = join(dirname(fileURLToPath(import.meta.url)), 'project-hook-runner.mjs');
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [runnerPath], {
      cwd: request.cwd,
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
      env: process.env,
    });
    let settled = false;
    let timedOut = false;
    let stderr = '';
    let killTimer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 250);
    }, hookPluginTimeoutMs());
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 500) stderr += chunk.toString().slice(0, 500 - stderr.length);
    });
    child.on('error', (error) => finish({ ok: false, reason: timedOut ? 'timeout' : error.message }));
    child.on('close', (status) => finish({
      ok: !timedOut && status === 0,
      reason: timedOut ? 'timeout' : status === 0 ? 'ok' : stderr.trim() || `exit_${String(status)}`,
    }));
    child.stdin.end(JSON.stringify(request));
  });
}

async function dispatchRetainedHookPlugins(eventName, payload, session) {
  if (/^(?:0|false|no)$/i.test(safeString(process.env.OWX_HOOK_PLUGINS))) return;
  const cwd = payloadCwd(payload);
  const hooksDir = join(cwd, '.owx', 'hooks');
  if (!existsSync(hooksDir)) return;
  const event = hookPluginEventName(eventName);
  const envelope = {
    schema_version: '1',
    event,
    timestamp: new Date().toISOString(),
    source: 'native',
    context: sanitizedHookPluginContext(eventName, payload, session),
    ...(session?.session_id ? { session_id: session.session_id } : {}),
    ...(payloadThreadId(payload) ? { thread_id: payloadThreadId(payload) } : {}),
    ...(payloadTurnId(payload) ? { turn_id: payloadTurnId(payload) } : {}),
  };
  for (const filename of readdirSync(hooksDir).filter((name) => name.endsWith('.mjs')).sort()) {
    const pluginPath = join(hooksDir, filename);
    try {
      if (!statSync(pluginPath).isFile()) continue;
      const pluginId = hookPluginId(filename);
      const result = await runProjectHookPlugin({ cwd, pluginId, pluginPath, event: envelope });
      appendJsonLine(lifecycleLogPath(cwd), {
        timestamp: new Date().toISOString(),
        event: 'hook-plugin-dispatch',
        hook_event: event,
        plugin_id: pluginId,
        status: result.ok ? 'ok' : 'failed',
        ...(result.ok ? {} : { reason: result.reason }),
      });
    } catch (error) {
      appendJsonLine(lifecycleLogPath(cwd), {
        timestamp: new Date().toISOString(),
        event: 'hook-plugin-dispatch',
        hook_event: event,
        plugin_id: hookPluginId(filename),
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function readNotificationConfig() {
  const configRoot = safeString(process.env.CODEX_HOME) || join(homedir(), '.codex');
  const raw = readOptionalStateFile(join(configRoot, '.owx-config.json'));
  const notifications = safeObject(raw?.notifications);
  if (Object.keys(notifications).length === 0) return null;
  const profiles = safeObject(notifications.profiles);
  if (Object.keys(profiles).length === 0) return notifications;
  const profileName = safeString(process.env.OWX_NOTIFY_PROFILE)
    || safeString(notifications.defaultProfile);
  if (!profileName || !Object.hasOwn(profiles, profileName)) return notifications;
  const profile = safeObject(profiles[profileName]);
  return {
    ...profile,
    enabled: notifications.enabled === true && profile.enabled === true,
  };
}

function selectedNotificationPlatforms() {
  try {
    const contract = JSON.parse(safeString(process.env.OWX_NOTIFY_TEMP_CONTRACT) || '{}');
    if (contract?.active !== true || !Array.isArray(contract.canonicalSelectors)) return null;
    return new Set(contract.canonicalSelectors.map((value) => safeString(value)).filter(Boolean));
  } catch {
    return null;
  }
}

function notificationPlatformConfigs(config) {
  const platforms = {
    discord: safeObject(config?.discord),
    'discord-bot': safeObject(config?.['discord-bot']),
    telegram: safeObject(config?.telegram),
    slack: safeObject(config?.slack),
    webhook: safeObject(config?.webhook),
  };
  if (process.env.OWX_DISCORD_WEBHOOK_URL) {
    platforms.discord = { enabled: true, webhookUrl: process.env.OWX_DISCORD_WEBHOOK_URL };
  }
  if (process.env.OWX_DISCORD_NOTIFIER_BOT_TOKEN && process.env.OWX_DISCORD_NOTIFIER_CHANNEL) {
    platforms['discord-bot'] = {
      enabled: true,
      botToken: process.env.OWX_DISCORD_NOTIFIER_BOT_TOKEN,
      channelId: process.env.OWX_DISCORD_NOTIFIER_CHANNEL,
    };
  }
  const telegramToken = process.env.OWX_TELEGRAM_BOT_TOKEN || process.env.OWX_TELEGRAM_NOTIFIER_BOT_TOKEN;
  const telegramChatId = process.env.OWX_TELEGRAM_CHAT_ID
    || process.env.OWX_TELEGRAM_NOTIFIER_CHAT_ID
    || process.env.OWX_TELEGRAM_NOTIFIER_UID;
  if (telegramToken && telegramChatId) {
    platforms.telegram = { enabled: true, botToken: telegramToken, chatId: telegramChatId };
  }
  if (process.env.OWX_SLACK_WEBHOOK_URL) {
    platforms.slack = { enabled: true, webhookUrl: process.env.OWX_SLACK_WEBHOOK_URL };
  }
  return platforms;
}

function validHttpsUrl(raw, allowedHosts = null) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (allowedHosts && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function postNotification(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4_000),
  });
  return response.ok;
}

async function sendNotificationPlatform(platform, config, message, event, sessionId, cwd) {
  if (config.enabled !== true) return false;
  if (platform === 'discord') {
    const url = validHttpsUrl(config.webhookUrl, ['discord.com', 'discordapp.com']);
    return url ? postNotification(url, { content: message }) : false;
  }
  if (platform === 'discord-bot') {
    const token = safeString(config.botToken);
    const channelId = safeString(config.channelId);
    if (!token || !/^\d+$/.test(channelId)) return false;
    return postNotification(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      { content: message },
      { authorization: `Bot ${token}` },
    );
  }
  if (platform === 'telegram') {
    const token = safeString(config.botToken);
    const chatId = safeString(config.chatId);
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token) || !chatId) return false;
    return postNotification(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: message });
  }
  if (platform === 'slack') {
    const url = validHttpsUrl(config.webhookUrl, ['hooks.slack.com']);
    return url ? postNotification(url, { text: message }) : false;
  }
  if (platform === 'webhook') {
    const url = validHttpsUrl(config.url);
    return url ? postNotification(url, { event, sessionId, projectPath: cwd, message }, safeObject(config.headers)) : false;
  }
  return false;
}

async function dispatchLifecycleNotification(event, payload, session) {
  if (!session) return;
  const cwd = payloadCwd(payload);
  const config = readNotificationConfig();
  const eventConfig = safeObject(config?.events?.[event]);
  const platforms = notificationPlatformConfigs({ ...safeObject(config), ...eventConfig });
  const selected = selectedNotificationPlatforms();
  const configEnabled = selected !== null
    || (config ? config.enabled === true : Object.values(platforms).some((platform) => platform.enabled === true));
  if (!configEnabled || eventConfig.enabled === false) return;
  const dedupePath = join(stateDirForCwd(cwd), 'notification-lifecycle.json');
  const dedupe = safeObject(readOptionalStateFile(dedupePath));
  const fingerprint = `${event}:${session.session_id}`;
  if (dedupe[fingerprint]?.sent === true) return;
  const message = `OWX ${event === 'session-start' ? 'session started' : 'session stopped'}: ${basename(cwd)} (${session.session_id})`;
  const attempts = Object.entries(platforms)
    .filter(([name, platformConfig]) => platformConfig.enabled === true && (!selected || selected.has(name)))
    .map(async ([name, platformConfig]) => {
      try {
        return { name, success: await sendNotificationPlatform(name, platformConfig, message, event, session.session_id, cwd) };
      } catch {
        return { name, success: false };
      }
    });
  if (attempts.length === 0) return;
  const results = await Promise.all(attempts);
  if (results.some((result) => result.success)) {
    writeJsonAtomic(dedupePath, {
      ...dedupe,
      [fingerprint]: { sent: true, sent_at: new Date().toISOString() },
    });
  }
  appendJsonLine(
    join(dirname(stateDirForCwd(cwd)), 'logs', `notifications-${new Date().toISOString().slice(0, 10)}.jsonl`),
    {
      timestamp: new Date().toISOString(),
      event,
      session_id: session.session_id,
      attempted_platforms: results.map((result) => result.name),
      successful_platforms: results.filter((result) => result.success).map((result) => result.name),
    },
  );
}

function writeHookContext(eventName, additionalContext) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext },
  })}\n`);
}

function readAuthoritativeWorkflow(payload, rawInput) {
  const cwdValue = typeof payload?.cwd === 'string'
    ? payload.cwd
    : extractTopLevelStringField(rawInput, ['cwd']);
  const cwd = cwdValue?.trim() || process.cwd();
  const stateDir = stateDirForCwd(cwd);
  const currentSession = readOptionalStateFile(join(stateDir, 'session.json'));
  if (!isSafeSessionId(currentSession?.session_id)) return null;
  if (typeof currentSession.cwd === 'string' && currentSession.cwd.trim()
    && canonicalPath(currentSession.cwd) !== canonicalPath(cwd)) return null;

  const sessionId = currentSession.session_id.trim();
  const payloadSessionId = typeof payload?.session_id === 'string'
    ? payload.session_id
    : extractTopLevelStringField(rawInput, ['session_id', 'sessionId']);
  if (isSafeSessionId(payloadSessionId) && payloadSessionId.trim() !== sessionId) return null;

  const sessionDir = join(stateDir, 'sessions', sessionId);
  const runState = readOptionalStateFile(join(sessionDir, 'run-state.json'));
  let terminalModeFile = null;
  if (runState) {
    const ownerSessionId = runState.owner_owx_session_id;
    if (isSafeSessionId(ownerSessionId) && ownerSessionId.trim() !== sessionId) return null;
    if (isActiveState(runState)) return runState;
    // A canonical terminal run state supersedes stale mode-specific state for its mode.
    if (typeof runState.mode === 'string' && runState.mode.trim()) {
      const modeFile = `${runState.mode.trim()}-state.json`;
      if (MODE_STATE_FILES.includes(modeFile)) terminalModeFile = modeFile;
    }
  }

  for (const filename of MODE_STATE_FILES) {
    if (filename === terminalModeFile) continue;
    const state = readOptionalStateFile(join(sessionDir, filename));
    if (!isActiveState(state)) continue;
    const ownerSessionId = state.owner_owx_session_id ?? state.session_id;
    if (isSafeSessionId(ownerSessionId) && ownerSessionId.trim() !== sessionId) continue;
    return state;
  }
  return null;
}

function blockActiveWorkflow(state) {
  const mode = String(state.mode ?? 'workflow').trim() || 'workflow';
  const phase = String(state.current_phase ?? 'active').trim() || 'active';
  const reason = `OWX ${mode} state is active for the current session (phase: ${phase}); continue the workflow before stopping.`;
  process.stdout.write(`${JSON.stringify({
    decision: 'block',
    reason,
    stopReason: 'plugin_stop_active_workflow',
    systemMessage: reason,
  })}\n`);
}

function allowStop() {
  process.stdout.write('{}\n');
}

async function readBoundedStdin() {
  const chunks = [];
  let totalBytes = 0;
  let storedBytes = 0;
  for await (const rawChunk of process.stdin) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.length;
    const remaining = MAX_STDIN_BYTES - storedBytes;
    if (remaining > 0) {
      const storedChunk = chunk.subarray(0, remaining);
      chunks.push(storedChunk);
      storedBytes += storedChunk.length;
    }
    if (totalBytes > MAX_STDIN_BYTES) return { rawInput: Buffer.concat(chunks).toString('utf8'), oversized: true };
  }
  return { rawInput: Buffer.concat(chunks).toString('utf8'), oversized: false };
}

async function main() {
  const { rawInput, oversized } = await readBoundedStdin();
  let payload = null;
  try {
    payload = JSON.parse(rawInput);
  } catch (error) {
    const eventName = extractTopLevelStringField(rawInput, ['hook_event_name', 'hookEventName', 'event', 'name']);
    if (eventName === 'Stop') {
      const activeState = readAuthoritativeWorkflow(null, rawInput);
      if (activeState) blockActiveWorkflow(activeState);
      else allowStop();
      return;
    }
    if (oversized) {
      console.error(`[owen-codex] plugin hook stdin exceeded ${MAX_STDIN_BYTES} bytes`);
      process.exitCode = 1;
      return;
    }
    console.error(`[owen-codex] plugin hook received malformed JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const eventName = payload?.hook_event_name ?? payload?.hookEventName ?? payload?.event ?? payload?.name;
  if (!CODEX_HOOK_EVENT_NAMES.has(eventName)) {
    console.error(`[owen-codex] unsupported plugin hook event: ${String(eventName ?? '')}`);
    process.exitCode = 1;
    return;
  }
  if (oversized && eventName !== 'Stop') {
    console.error(`[owen-codex] plugin hook stdin exceeded ${MAX_STDIN_BYTES} bytes`);
    process.exitCode = 1;
    return;
  }
  const childMetadata = readNativeSubagentMetadata(payload);
  if (eventName === 'Stop' && childMetadata) {
    const cwd = payloadCwd(payload);
    const current = readCurrentSession(cwd);
    const childSessionId = payloadSessionId(payload);
    if (current && childSessionId) {
      recordTrackedThread(cwd, current.session_id, {
        threadId: childSessionId,
        kind: 'subagent',
        role: childMetadata.role,
        provenanceKind: 'native_session_stop',
        completed: true,
        completionSource: 'native_stop_hook',
      });
      recordLifecycleEvent(eventName, payload, current, { native_subagent: true, status: 'closed' });
    }
    allowStop();
    return;
  }

  const session = eventName === 'SessionStart'
    ? recordSessionStart(payload)
    : resolveSessionObservation(payload);
  recordLifecycleEvent(eventName, payload, session, childMetadata ? { native_subagent: true } : {});
  await dispatchRetainedHookPlugins(eventName, payload, session);

  if (eventName === 'SessionStart') {
    if (!childMetadata) {
      await dispatchLifecycleNotification('session-start', payload, session);
      writeHookContext(
        eventName,
        'OWX plugin lifecycle observation is active. Use Codex native subagents directly for bounded independent work; OWX records only observed lifecycle evidence.',
      );
    }
    return;
  }

  if (eventName === 'UserPromptSubmit') {
    const skill = recordWorkflowActivation(payload, session);
    if (skill) {
      writeHookContext(
        eventName,
        `OWX observed explicit retained workflow skill "$${skill}". Follow the installed skill contract and use Codex native subagents directly when it calls for independent lanes.`,
      );
    }
    return;
  }

  if (eventName === 'PostToolUse') {
    recordPostToolUse(payload, session);
    recordNativeAgentFailureEvidence(payload, session);
    return;
  }

  if (eventName === 'PreToolUse') {
    const boundary = buildPlanningBoundaryOutput(payload, session);
    if (boundary) process.stdout.write(`${JSON.stringify(boundary)}\n`);
    return;
  }

  if (eventName !== 'Stop') return;
  await dispatchLifecycleNotification('session-stop', payload, session);
  const activeState = readAuthoritativeWorkflow(payload, rawInput);
  if (activeState) blockActiveWorkflow(activeState);
  else allowStop();
}

main().catch((error) => {
  console.error(`[owen-codex] standalone plugin hook failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
