export type HookSchemaVersion = '1';
export type HookEventSource = 'native' | 'derived';

export type HookEventName =
  | 'session-start'
  | 'stop'
  | 'session-end'
  | 'session-idle'
  | 'turn-complete'
  | 'blocked'
  | 'run.heartbeat'
  | 'run.blocked_on_user'
  | 'run.blocked_on_system'
  | 'finished'
  | 'failed'
  | 'retry-needed'
  | 'pr-created'
  | 'test-started'
  | 'test-finished'
  | 'test-failed'
  | 'handoff-needed'
  | 'needs-input'
  | 'pre-tool-use'
  | 'post-tool-use'
  | (string & {});

export interface HookEventEnvelope {
  schema_version: HookSchemaVersion;
  event: HookEventName;
  timestamp: string;
  source: HookEventSource;
  context: Record<string, unknown>;
  session_id?: string;
  thread_id?: string;
  turn_id?: string;
  mode?: string;
  confidence?: number;
  parser_reason?: string;
}

export interface HookPluginDescriptor {
  id: string;
  name: string;
  file: string;
  path: string;
  filePath: string;
  fileName: string;
  valid: boolean;
  reason?: string;
}

export interface HookPluginLogContext {
  timestamp?: string;
  event: string;
  plugin_id?: string;
  status?: string;
  reason?: string;
  source?: HookEventSource;
  [key: string]: unknown;
}

export interface HookPluginOmxSessionState {
  session_id: string;
  native_session_id?: string;
  started_at?: string;
  cwd?: string;
  pid?: number;
  platform?: NodeJS.Platform;
  pid_start_ticks?: number;
  pid_cmdline?: string;
  [key: string]: unknown;
}

export interface HookPluginOmxHudState {
  last_turn_at?: string;
  turn_count?: number;
  last_agent_output?: string;
  [key: string]: unknown;
}

export interface HookPluginOmxUpdateCheckState {
  last_checked_at?: string;
  last_seen_latest?: string;
  [key: string]: unknown;
}

export interface HookPluginOmxSdk {
  session: {
    read: () => Promise<HookPluginOmxSessionState | null>;
  };
  hud: {
    read: () => Promise<HookPluginOmxHudState | null>;
  };
  updateCheck: {
    read: () => Promise<HookPluginOmxUpdateCheckState | null>;
  };
}

export interface HookPluginSdk {
  log: {
    info: (message: string, meta?: Record<string, unknown>) => Promise<void>;
    warn: (message: string, meta?: Record<string, unknown>) => Promise<void>;
    error: (message: string, meta?: Record<string, unknown>) => Promise<void>;
  };
  state: {
    read: <T = unknown>(key: string, fallback?: T) => Promise<T | undefined>;
    write: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    all: <T extends Record<string, unknown> = Record<string, unknown>>() => Promise<T>;
  };
  owx: HookPluginOmxSdk;
}

export interface HookPluginModule {
  onHookEvent?: (event: HookEventEnvelope, sdk: HookPluginSdk) => unknown | Promise<unknown>;
}

export type HookPluginDispatchStatus =
  | 'ok'
  | 'timeout'
  | 'error'
  | 'invalid_export'
  | 'runner_error'
  | 'spawn_failed'
  | 'runner_missing'
  | 'skipped';

export interface HookPluginDispatchResult {
  plugin_id?: string;
  file?: string;
  status?: HookPluginDispatchStatus;
  duration_ms?: number;
  reason?: string;
  output?: unknown;
  error?: string;

  // Preferred rich result fields
  plugin: string;
  path: string;
  ok: boolean;
  durationMs: number;
  exitCode?: number | null;
  skipped?: boolean;
}

export interface HookDispatchResult {
  enabled: boolean;
  event: string;
  source?: HookEventSource;
  plugin_count?: number;
  reason?: string;
  results: HookPluginDispatchResult[];
}

export type HookDispatchSummary = HookDispatchResult;

export interface HookDispatchOptions {
  cwd?: string;
  event?: HookEventEnvelope;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  sideEffectsEnabled?: boolean;
  enabled?: boolean;
}

export interface HookValidateOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface HookRuntimeDispatchInput {
  cwd: string;
  event: HookEventEnvelope;
  sideEffectsEnabled?: boolean;
}

export interface HookRuntimeDispatchResult {
  dispatched: boolean;
  reason: string;
  result: HookDispatchResult;
}
