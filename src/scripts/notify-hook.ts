#!/usr/bin/env node

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { buildDerivedHookEvent, buildHookEvent } from '../hooks/extensibility/events.js';
import { dispatchHookEvent } from '../hooks/extensibility/dispatcher.js';
import { notifyLifecycle } from '../notifications/index.js';
import {
  MAX_NOTIFY_ARGV_JSON_BYTES,
  utf8ByteLength,
} from './hook-payload-guard.js';
import {
  buildOperationalContext,
  deriveAssistantSignalEvents,
} from './notify-hook/operational-events.js';
import { normalizeInputMessages } from './notify-hook/payload-parser.js';
import { safeString } from './notify-hook/utils.js';

function isTurnComplete(payload: Record<string, unknown>): boolean {
  const type = safeString(payload.type).trim().toLowerCase();
  return type === '' || type === 'agent-turn-complete' || type === 'turn-complete';
}

async function main(): Promise<void> {
  const rawPayload = process.argv.at(-1);
  if (!rawPayload || rawPayload.startsWith('-') || utf8ByteLength(rawPayload) > MAX_NOTIFY_ARGV_JSON_BYTES) return;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawPayload) as Record<string, unknown>;
  } catch {
    return;
  }

  const cwd = safeString(payload.cwd).trim() || process.cwd();
  const sessionId = safeString(payload.session_id || payload['session-id']).trim();
  const threadId = safeString(payload.thread_id || payload['thread-id']).trim();
  const turnId = safeString(payload.turn_id || payload['turn-id']).trim();
  const output = safeString(payload.last_assistant_message || payload['last-assistant-message']);
  const logsDir = join(cwd, '.owx', 'logs');

  await mkdir(logsDir, { recursive: true }).catch(() => {});
  await appendFile(join(logsDir, `turns-${new Date().toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify({
    timestamp: new Date().toISOString(),
    type: payload.type || 'agent-turn-complete',
    thread_id: threadId || undefined,
    turn_id: turnId || undefined,
    input_message_count: normalizeInputMessages(payload).length,
    output_preview: output.slice(0, 200),
  })}\n`).catch(() => {});

  if (!isTurnComplete(payload)) return;

  const event = buildHookEvent('turn-complete', {
    session_id: sessionId,
    thread_id: threadId,
    turn_id: turnId,
    context: buildOperationalContext({ cwd, output }),
  });
  await dispatchHookEvent(event, { cwd }).catch(() => {});

  for (const signal of deriveAssistantSignalEvents(output)) {
    const derived = buildDerivedHookEvent(signal.event, buildOperationalContext({
      cwd,
      output,
      normalizedEvent: signal.normalized_event,
    }), {
      confidence: signal.confidence,
      parser_reason: signal.parser_reason,
      session_id: sessionId,
      thread_id: threadId,
      turn_id: turnId,
    });
    await dispatchHookEvent(derived, { cwd }).catch(() => {});
  }

  if (sessionId) {
    await notifyLifecycle('session-idle', {
      sessionId,
      projectPath: cwd,
      reason: 'turn-complete',
    }).catch(() => null);
  }
}

void main();
