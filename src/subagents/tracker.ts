import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getBaseStateDir } from '../state/paths.js';

export const SUBAGENT_TRACKING_SCHEMA_VERSION = 1;
export const DEFAULT_SUBAGENT_ACTIVE_WINDOW_MS = 120_000;
export const NATIVE_SUBAGENT_SUPPORT_BLOCKER_FILE = 'native-subagent-support.json';
export const NATIVE_SUBAGENT_CAPACITY_BLOCKER_FILE = 'native-subagent-capacity.json';

export type SubagentAvailabilityStatus = 'available' | 'closed' | 'unavailable';
export type NativeSubagentSupportStatus = 'supported' | 'unsupported' | 'unknown';
export type NativeSubagentUnsupportedReason =
  | 'native_subagents_unsupported'
  | 'multi_agent_v1_unavailable'
  | 'agent_thread_limit_reached';
export type NativeSubagentSupportEvidenceSource =
  | 'hook_payload_capability'
  | 'hook_payload_available_tools'
  | 'persisted_support_blocker'
  | 'capacity_blocker'
  | 'default_unknown';
export type NativeSubagentRecoverySupport = 'supported_native' | 'unsupported_native' | 'unknown_native';
export type NativeSubagentRecoveryOutcome =
  | 'delegated'
  | 'completed'
  | 'blocked'
  | 'explicit_recovery_nonclean';

export interface NativeSubagentSupportEvidence {
  status: NativeSubagentSupportStatus;
  reason?: NativeSubagentUnsupportedReason;
  source: NativeSubagentSupportEvidenceSource;
  evidence_summary?: string;
  observed_at?: string;
  expires_at?: string;
  cwd?: string;
  session_id?: string;
}

export interface NativeSubagentRecoveryRecord {
  schema_version: 1;
  support: NativeSubagentRecoverySupport;
  outcome: NativeSubagentRecoveryOutcome;
  clean: boolean;
  reason?: string;
}

export interface NativeSubagentCapabilityInput {
  payload?: Record<string, unknown> | null;
  persistedSupportBlocker?: Record<string, unknown> | null;
  persistedCapacityBlocker?: Record<string, unknown> | null;
  nowMs?: number;
  cwd?: string;
  sessionId?: string;
}

export interface TrackedSubagentThread {
  thread_id: string;
  kind: 'leader' | 'subagent';
  first_seen_at: string;
  last_seen_at: string;
  completed_at?: string;
  last_turn_id?: string;
  last_completed_turn_id?: string;
  turn_count: number;
  mode?: string;
  completion_source?: string;
  status?: SubagentAvailabilityStatus;
}

export interface TrackedSubagentSession {
  session_id: string;
  leader_thread_id?: string;
  updated_at: string;
  threads: Record<string, TrackedSubagentThread>;
}

export interface SubagentTrackingState {
  schemaVersion: 1;
  sessions: Record<string, TrackedSubagentSession>;
}

export interface RecordSubagentTurnInput {
  sessionId: string;
  threadId: string;
  turnId?: string;
  timestamp?: string;
  mode?: string;
  kind?: 'leader' | 'subagent';
  leaderThreadId?: string;
  completed?: boolean;
  completionSource?: string;
  status?: SubagentAvailabilityStatus;
  preserveCompletionEvidence?: boolean;
}

export interface SubagentSessionSummary {
  sessionId: string;
  leaderThreadId?: string;
  allThreadIds: string[];
  allSubagentThreadIds: string[];
  activeSubagentThreadIds: string[];
  updatedAt?: string;
}

export function subagentTrackingPath(cwd: string): string {
  return join(getBaseStateDir(cwd), 'subagent-tracking.json');
}

export function nativeSubagentSupportPath(cwd: string, sessionId: string): string {
  return join(getBaseStateDir(cwd), 'sessions', sessionId, NATIVE_SUBAGENT_SUPPORT_BLOCKER_FILE);
}

export function nativeSubagentCapacityPath(cwd: string, sessionId: string): string {
  return join(getBaseStateDir(cwd), 'sessions', sessionId, NATIVE_SUBAGENT_CAPACITY_BLOCKER_FILE);
}

function supportRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function supportString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function blockerMatchesScope(
  blocker: Record<string, unknown>,
  input: Pick<NativeSubagentCapabilityInput, 'cwd' | 'sessionId' | 'nowMs'>,
): boolean {
  const blockerCwd = supportString(blocker.cwd);
  if (blockerCwd && blockerCwd !== input.cwd) return false;
  const blockerSessionId = supportString(blocker.session_id ?? blocker.sessionId);
  if (blockerSessionId && blockerSessionId !== input.sessionId) return false;
  const expiresAt = supportString(blocker.expires_at ?? blocker.expiresAt);
  if (!expiresAt) return true;
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > (input.nowMs ?? Date.now());
}

function isUnsupportedReason(value: unknown): value is NativeSubagentUnsupportedReason {
  return value === 'native_subagents_unsupported'
    || value === 'multi_agent_v1_unavailable'
    || value === 'agent_thread_limit_reached';
}

function supportEvidenceFromBlocker(
  blocker: Record<string, unknown> | null | undefined,
  source: 'persisted_support_blocker' | 'capacity_blocker',
  input: NativeSubagentCapabilityInput,
): NativeSubagentSupportEvidence | null {
  if (!blocker || !blockerMatchesScope(blocker, input)) return null;
  if (supportString(blocker.source) !== source) return null;
  const reason = blocker.reason;
  if (!isUnsupportedReason(reason)) return null;
  const common = {
    reason,
    source,
    ...(supportString(blocker.error_summary ?? blocker.evidence_summary ?? blocker.evidence)
      ? { evidence_summary: supportString(blocker.error_summary ?? blocker.evidence_summary ?? blocker.evidence) }
      : {}),
    ...(supportString(blocker.observed_at) ? { observed_at: supportString(blocker.observed_at) } : {}),
    ...(supportString(blocker.expires_at) ? { expires_at: supportString(blocker.expires_at) } : {}),
    ...(supportString(blocker.cwd) ? { cwd: supportString(blocker.cwd) } : {}),
    ...(supportString(blocker.session_id) ? { session_id: supportString(blocker.session_id) } : {}),
  } as const;
  if (reason === 'agent_thread_limit_reached') {
    return source === 'capacity_blocker' ? { status: 'unknown', ...common } : null;
  }
  return source === 'persisted_support_blocker' && supportString(blocker.status || 'unsupported') === 'unsupported'
    ? { status: 'unsupported', ...common }
    : null;
}

function capabilityStatusFromRecord(record: Record<string, unknown> | null): NativeSubagentSupportStatus | null {
  if (!record) return null;
  const nativeSubagents = record.native_subagents ?? record.nativeSubagents;
  const multiAgent = record.multi_agent_v1 ?? record.multiAgentV1;
  if (nativeSubagents === false || multiAgent === false) return 'unsupported';
  if (nativeSubagents === true || multiAgent === true) return 'supported';
  return null;
}

function availableToolNames(payload: Record<string, unknown> | null): string[] | null {
  const tools = payload?.available_tools ?? payload?.availableTools ?? payload?.tools;
  if (!Array.isArray(tools)) return null;
  return tools.map((tool) => {
    if (typeof tool === 'string') return tool.trim();
    const record = supportRecord(tool);
    return supportString(record?.name ?? record?.tool_name ?? record?.toolName);
  }).filter(Boolean);
}

export function resolveNativeSubagentSupportStatus(
  input: NativeSubagentCapabilityInput,
): NativeSubagentSupportEvidence {
  const persisted = supportEvidenceFromBlocker(input.persistedSupportBlocker, 'persisted_support_blocker', input);
  if (persisted) return persisted;

  const payload = supportRecord(input.payload);
  const capability = supportRecord(payload?.owx_runtime_capabilities) ?? supportRecord(payload?.capabilities);
  const capabilityStatus = capabilityStatusFromRecord(capability);
  if (capabilityStatus === 'unsupported') {
    return {
      status: 'unsupported',
      reason: capability?.native_subagents === false || capability?.nativeSubagents === false
        ? 'native_subagents_unsupported'
        : 'multi_agent_v1_unavailable',
      source: 'hook_payload_capability',
      evidence_summary: 'payload capability reports native subagent support unavailable',
    };
  }
  if (capabilityStatus === 'supported') {
    return {
      status: 'supported',
      source: 'hook_payload_capability',
      evidence_summary: 'payload capability reports native subagent support',
    };
  }

  const tools = availableToolNames(payload);
  if (tools) {
    const supported = tools.some((name) => /(?:^|\.)spawn_agent$/.test(name) || /multi_agent_v1\.spawn_agent/.test(name));
    return {
      status: supported ? 'supported' : 'unsupported',
      ...(supported ? {} : { reason: 'multi_agent_v1_unavailable' as const }),
      source: 'hook_payload_available_tools',
      evidence_summary: tools.join(', '),
    };
  }

  const capacity = supportEvidenceFromBlocker(input.persistedCapacityBlocker, 'capacity_blocker', input);
  return capacity ?? { status: 'unknown', source: 'default_unknown' };
}

export function isUnsupportedNativeSubagentEvidenceForScope(
  value: unknown,
  input: Pick<NativeSubagentCapabilityInput, 'cwd' | 'sessionId' | 'nowMs'> = {},
): value is NativeSubagentSupportEvidence {
  const record = supportRecord(value);
  if (!input.cwd || !input.sessionId) return false;
  if (!record || record.status !== 'unsupported' || !blockerMatchesScope(record, input)) return false;
  if (record.source !== 'persisted_support_blocker') return false;
  if (supportString(record.cwd) !== input.cwd || supportString(record.session_id) !== input.sessionId) return false;
  return record.reason !== 'agent_thread_limit_reached'
    && isUnsupportedReason(record.reason);
}

export function evaluateNativeSubagentRecovery(
  support: NativeSubagentRecoverySupport,
  outcome: NativeSubagentRecoveryOutcome,
): { allowed: boolean; record: NativeSubagentRecoveryRecord; reason: string } {
  const clean = support === 'supported_native' && outcome === 'completed';
  const allowed = support === 'supported_native'
    ? outcome === 'delegated' || outcome === 'completed'
    : support === 'unsupported_native'
      ? outcome === 'blocked' || outcome === 'explicit_recovery_nonclean'
      : false;
  const reason = allowed
    ? clean
      ? 'tracker-backed native delegation completed cleanly'
      : support === 'supported_native'
        ? 'native delegation remains in progress'
        : 'native support is unavailable and recovery is terminal non-clean'
    : support === 'unsupported_native' && outcome === 'completed'
      ? 'unsupported native evidence can never clean-complete'
      : `invalid native recovery transition: ${support} -> ${outcome}`;
  return {
    allowed,
    record: { schema_version: 1, support, outcome, clean, reason },
    reason,
  };
}

export function createSubagentTrackingState(): SubagentTrackingState {
  return {
    schemaVersion: SUBAGENT_TRACKING_SCHEMA_VERSION,
    sessions: {},
  };
}

function normalizeSubagentStatus(value: unknown): SubagentAvailabilityStatus | undefined {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'available' || normalized === 'closed' || normalized === 'unavailable'
    ? normalized
    : undefined;
}

export function isTrustedSubagentThread(
  session: TrackedSubagentSession | null | undefined,
  threadId: string,
): boolean {
  const normalizedThreadId = threadId.trim();
  if (!session || !normalizedThreadId) return false;
  const leaderThreadId = session.leader_thread_id?.trim();
  if (leaderThreadId && leaderThreadId === normalizedThreadId) return false;
  return session.threads[normalizedThreadId]?.kind === 'subagent';
}

export function normalizeSubagentTrackingState(input: unknown): SubagentTrackingState {
  const base = createSubagentTrackingState();
  if (!input || typeof input !== 'object') return base;

  const parsed = input as Partial<SubagentTrackingState>;
  const sessions: Record<string, TrackedSubagentSession> = {};
  for (const [sessionId, rawSession] of Object.entries(parsed.sessions ?? {})) {
    if (!rawSession || typeof rawSession !== 'object') continue;
    const threads: Record<string, TrackedSubagentThread> = {};
    for (const [threadId, rawThread] of Object.entries((rawSession as TrackedSubagentSession).threads ?? {})) {
      if (!rawThread || typeof rawThread !== 'object') continue;
      const candidate = rawThread as Partial<TrackedSubagentThread>;
      const normalizedThreadId = typeof candidate.thread_id === 'string' && candidate.thread_id.trim().length > 0
        ? candidate.thread_id.trim()
        : threadId.trim();
      if (!normalizedThreadId) continue;
      if (candidate.kind !== 'leader' && candidate.kind !== 'subagent') continue;
      const kind = candidate.kind;
      const firstSeenAt = typeof candidate.first_seen_at === 'string' && candidate.first_seen_at.trim().length > 0
        ? candidate.first_seen_at
        : typeof candidate.last_seen_at === 'string' && candidate.last_seen_at.trim().length > 0
          ? candidate.last_seen_at
          : new Date(0).toISOString();
      const lastSeenAt = typeof candidate.last_seen_at === 'string' && candidate.last_seen_at.trim().length > 0
        ? candidate.last_seen_at
        : firstSeenAt;
      threads[normalizedThreadId] = {
        thread_id: normalizedThreadId,
        kind,
        first_seen_at: firstSeenAt,
        last_seen_at: lastSeenAt,
        ...(typeof candidate.last_turn_id === 'string' && candidate.last_turn_id.trim().length > 0
          ? { last_turn_id: candidate.last_turn_id }
          : {}),
        ...(typeof candidate.completed_at === 'string' && candidate.completed_at.trim().length > 0
          ? { completed_at: candidate.completed_at }
          : {}),
        ...(typeof candidate.last_completed_turn_id === 'string' && candidate.last_completed_turn_id.trim().length > 0
          ? { last_completed_turn_id: candidate.last_completed_turn_id }
          : {}),
        turn_count: typeof candidate.turn_count === 'number' && Number.isFinite(candidate.turn_count) && candidate.turn_count > 0
          ? candidate.turn_count
          : 1,
        ...(typeof candidate.mode === 'string' && candidate.mode.trim().length > 0 ? { mode: candidate.mode } : {}),
        ...(typeof candidate.completion_source === 'string' && candidate.completion_source.trim().length > 0 ? { completion_source: candidate.completion_source } : {}),
        ...(normalizeSubagentStatus(candidate.status) ? { status: normalizeSubagentStatus(candidate.status) } : {}),
      };
    }

    const sessionCandidate = rawSession as TrackedSubagentSession;
    const leaderThreadId = typeof sessionCandidate.leader_thread_id === 'string'
      ? sessionCandidate.leader_thread_id.trim() || undefined
      : undefined;
    const updatedAt = typeof sessionCandidate.updated_at === 'string' && sessionCandidate.updated_at.trim().length > 0
      ? sessionCandidate.updated_at
      : new Date(0).toISOString();

    sessions[sessionId] = {
      session_id: sessionId,
      leader_thread_id: leaderThreadId,
      updated_at: updatedAt,
      threads,
    };
  }

  return {
    schemaVersion: SUBAGENT_TRACKING_SCHEMA_VERSION,
    sessions,
  };
}

export async function readSubagentTrackingState(cwd: string): Promise<SubagentTrackingState> {
  const path = subagentTrackingPath(cwd);
  if (!existsSync(path)) return createSubagentTrackingState();
  try {
    return normalizeSubagentTrackingState(JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return createSubagentTrackingState();
  }
}

export async function writeSubagentTrackingState(cwd: string, state: SubagentTrackingState): Promise<string> {
  const normalized = normalizeSubagentTrackingState(state);
  const path = subagentTrackingPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`);
  return path;
}

export function recordSubagentTurn(
  state: SubagentTrackingState,
  input: RecordSubagentTurnInput,
): SubagentTrackingState {
  const sessionId = input.sessionId.trim();
  const threadId = input.threadId.trim();
  if (!sessionId || !threadId) return normalizeSubagentTrackingState(state);

  const timestamp = input.timestamp ?? new Date().toISOString();
  const normalized = normalizeSubagentTrackingState(state);
  const existingSession = normalized.sessions[sessionId] ?? {
    session_id: sessionId,
    updated_at: timestamp,
    threads: {},
  };

  const requestedKind = input.kind === 'leader' || input.kind === 'subagent' ? input.kind : undefined;
  const requestedLeaderThreadId = input.leaderThreadId?.trim();
  const existingThread = existingSession.threads[threadId];
  const existingKind = existingThread?.kind === 'leader' || existingThread?.kind === 'subagent'
    ? existingThread.kind
    : undefined;
  const existingLeaderThreadId = existingSession.leader_thread_id?.trim();
  // `leader_thread_id` is the session's top-level leader boundary.  A native
  // subagent can itself be the immediate parent of a nested native role, but
  // that must not reclassify known subagent evidence as the session leader.
  const requestedLeaderThread = requestedLeaderThreadId
    ? existingSession.threads[requestedLeaderThreadId]
    : undefined;
  const requestedLeaderWouldReclassifySubagent = requestedLeaderThread?.kind === 'subagent';
  const requestedSessionLeaderThreadId = requestedLeaderWouldReclassifySubagent
    ? undefined
    : requestedLeaderThreadId;
  const preserveExistingSubagent = existingKind === 'subagent' && requestedKind !== 'subagent';
  const preserveKnownLeader = requestedKind === 'subagent'
    && (existingKind === 'leader' || existingLeaderThreadId === threadId);
  const leaderThreadId = preserveKnownLeader
    ? existingLeaderThreadId || threadId
    : existingLeaderThreadId
      || requestedSessionLeaderThreadId
      || (requestedKind === 'subagent' || preserveExistingSubagent ? undefined : threadId);
  const kind = preserveKnownLeader
    ? 'leader'
    : requestedKind === 'leader' && existingKind === 'subagent'
      ? 'subagent'
      : requestedKind ?? (threadId === leaderThreadId ? 'leader' : existingKind ?? 'subagent');
  const preserveCompletionEvidence = input.preserveCompletionEvidence === true;
  const preservedCompletionEvidence = preserveCompletionEvidence
    ? {
        ...(existingThread?.completed_at ? { completed_at: existingThread.completed_at } : {}),
        ...(existingThread?.last_completed_turn_id
          ? { last_completed_turn_id: existingThread.last_completed_turn_id }
          : {}),
        ...(existingThread?.completion_source ? { completion_source: existingThread.completion_source } : {}),
      }
    : {};
  const status = normalizeSubagentStatus(input.status)
    ?? (preserveCompletionEvidence ? normalizeSubagentStatus(existingThread?.status) : undefined);
  const nextThread: TrackedSubagentThread = {
    thread_id: threadId,
    kind,
    first_seen_at: existingThread?.first_seen_at ?? timestamp,
    last_seen_at: timestamp,
    turn_count: (existingThread?.turn_count ?? 0) + 1,
    ...(input.turnId?.trim() ? { last_turn_id: input.turnId.trim() } : existingThread?.last_turn_id ? { last_turn_id: existingThread.last_turn_id } : {}),
    ...(input.completed
      ? {
          completed_at: timestamp,
          ...(input.turnId?.trim()
            ? { last_completed_turn_id: input.turnId.trim() }
            : preserveCompletionEvidence && existingThread?.last_completed_turn_id
              ? { last_completed_turn_id: existingThread.last_completed_turn_id }
              : {}),
          ...(input.completionSource?.trim()
            ? { completion_source: input.completionSource.trim() }
            : preserveCompletionEvidence && existingThread?.completion_source
              ? { completion_source: existingThread.completion_source }
              : {}),
        }
      : preservedCompletionEvidence),
    ...(input.mode?.trim() ? { mode: input.mode.trim() } : existingThread?.mode ? { mode: existingThread.mode } : {}),
    ...(status ? { status } : {}),
  };

  const threads = {
    ...existingSession.threads,
    [threadId]: nextThread,
  };
  if (leaderThreadId && threadId !== leaderThreadId && threads[leaderThreadId]) {
    threads[leaderThreadId] = {
      ...threads[leaderThreadId],
      kind: 'leader',
    };
  }

  normalized.sessions[sessionId] = {
    session_id: sessionId,
    ...(leaderThreadId ? { leader_thread_id: leaderThreadId } : {}),
    updated_at: timestamp,
    threads,
  };
  return normalized;
}

export async function recordSubagentTurnForSession(cwd: string, input: RecordSubagentTurnInput): Promise<SubagentTrackingState> {
  const current = await readSubagentTrackingState(cwd);
  const next = recordSubagentTurn(current, input);
  await writeSubagentTrackingState(cwd, next);
  return next;
}

export function summarizeSubagentSession(
  state: SubagentTrackingState,
  sessionId: string,
  options: { now?: string | Date; activeWindowMs?: number } = {},
): SubagentSessionSummary | null {
  const normalized = normalizeSubagentTrackingState(state);
  const session = normalized.sessions[sessionId];
  if (!session) return null;

  const activeWindowMs = options.activeWindowMs ?? DEFAULT_SUBAGENT_ACTIVE_WINDOW_MS;
  const nowMs = typeof options.now === 'string'
    ? Date.parse(options.now)
    : options.now instanceof Date
      ? options.now.getTime()
      : Date.now();

  const allThreadIds = Object.keys(session.threads).sort();
  const allSubagentThreadIds = allThreadIds.filter((threadId) => isTrustedSubagentThread(session, threadId));
  const activeSubagentThreadIds = allSubagentThreadIds.filter((threadId) => {
    const thread = session.threads[threadId];
    if (!thread) return false;
    if (thread.completed_at) return false;
    const seenAt = Date.parse(thread.last_seen_at);
    if (!Number.isFinite(seenAt)) return false;
    return nowMs - seenAt <= activeWindowMs;
  });

  return {
    sessionId,
    leaderThreadId: session.leader_thread_id,
    allThreadIds,
    allSubagentThreadIds,
    activeSubagentThreadIds,
    updatedAt: session.updated_at,
  };
}

export async function readSubagentSessionSummary(
  cwd: string,
  sessionId: string,
  options: { now?: string | Date; activeWindowMs?: number } = {},
): Promise<SubagentSessionSummary | null> {
  return summarizeSubagentSession(await readSubagentTrackingState(cwd), sessionId, options);
}
