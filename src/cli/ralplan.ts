import { randomUUID } from 'node:crypto';
import {
  buildRoleIntentSpawnTaskName,
  isAppCompatibleSpawnTaskName,
  parseRoleIntentCorrelationToken,
} from '../leader/contract.js';
import { resolveRuntimeStateScope } from '../mcp/state-paths.js';
import { readSubagentTrackingState, recordPendingRoleIntent } from '../subagents/tracker.js';

export const RALPLAN_HELP = `owx ralplan - Ralplan consensus support commands

Usage:
  owx ralplan role-intent write --role <role> --parent-thread <id> [--session <id>] [--ttl-ms <n>] [--json]
`;

export async function ralplanCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args.some((arg) => arg === '--help' || arg === '-h' || arg === 'help')) {
    console.log(RALPLAN_HELP);
    return;
  }
  if (args[0] !== 'role-intent' || args[1] !== 'write') {
    throw new Error(`Unknown ralplan command: ${args.join(' ')}\n${RALPLAN_HELP}`);
  }
  const parsed = parseRoleIntentWriteArgs(args.slice(2));
  const currentScope = await resolveRuntimeStateScope(process.cwd());
  if (!currentScope.sessionId) return emitFailure('native_anchor_unavailable', parsed.json);
  if (parsed.sessionId) {
    const requested = await resolveRuntimeStateScope(process.cwd(), parsed.sessionId);
    if (requested.sessionId !== currentScope.sessionId) return emitFailure('session_not_current', parsed.json);
  }
  const tracking = await readSubagentTrackingState(currentScope.cwd);
  const session = tracking.sessions[currentScope.sessionId];
  if (!session?.leader_attested_at) return emitFailure('native_anchor_unavailable', parsed.json);
  const correlationToken = randomUUID().replace(/-/g, '');
  const result = await recordPendingRoleIntent(currentScope.cwd, {
    role: parsed.role,
    sessionId: currentScope.sessionId,
    parentThreadId: parsed.parentThreadId,
    correlationToken,
    ...(parsed.ttlMs ? { ttlMs: parsed.ttlMs } : {}),
  });
  if (!result.ok) return emitFailure(result.reason, parsed.json);
  const spawnTaskName = buildRoleIntentSpawnTaskName(result.intent.correlation_token);
  if (!isAppCompatibleSpawnTaskName(spawnTaskName)
    || parseRoleIntentCorrelationToken(spawnTaskName) !== result.intent.correlation_token) {
    return emitFailure('spawn_task_name_unsupported', parsed.json);
  }
  const receipt = {
    ok: true,
    intent: {
      role: result.intent.role,
      session_id: result.intent.session_id,
      parent_thread_id: result.intent.parent_thread_id,
      correlation_token: result.intent.correlation_token,
      expires_at: result.intent.expires_at,
    },
    spawn_task_name: spawnTaskName,
  };
  console.log(parsed.json ? JSON.stringify(receipt) : `role-intent recorded: ${spawnTaskName}`);
}

function parseRoleIntentWriteArgs(args: string[]): {
  role: string;
  parentThreadId: string;
  sessionId?: string;
  ttlMs?: number;
  json: boolean;
} {
  const values: Record<string, string> = {};
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    const [key, inlineValue] = arg.split('=', 2);
    if (!['--role', '--parent-thread', '--session', '--ttl-ms'].includes(key)) {
      throw new Error(`Unknown role-intent argument: ${arg}`);
    }
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value after ${key}.`);
    values[key] = value;
  }
  if (!values['--role']) throw new Error('Missing --role.');
  if (!values['--parent-thread']) throw new Error('Missing --parent-thread.');
  const ttlMs = values['--ttl-ms'] ? Number(values['--ttl-ms']) : undefined;
  if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)) {
    throw new Error('--ttl-ms must be a positive integer.');
  }
  return {
    role: values['--role'],
    parentThreadId: values['--parent-thread'],
    ...(values['--session'] ? { sessionId: values['--session'] } : {}),
    ...(ttlMs ? { ttlMs } : {}),
    json,
  };
}

function emitFailure(reason: string, json: boolean): void {
  const message = JSON.stringify({ ok: false, reason });
  if (json) console.log(message);
  else console.error(`role-intent write failed: ${reason}`);
  process.exitCode = 1;
}
