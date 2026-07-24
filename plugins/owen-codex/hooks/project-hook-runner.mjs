#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_INPUT_BYTES = 1024 * 1024;

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stateDir(cwd) {
  if (process.env.OWX_ROOT?.trim()) return join(process.env.OWX_ROOT.trim(), '.owx', 'state');
  if (process.env.OWX_STATE_ROOT?.trim()) return join(process.env.OWX_STATE_ROOT.trim(), '.owx', 'state');
  return join(cwd, '.owx', 'state');
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function appendJsonLine(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function normalizeStateKey(key) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) throw new Error('state key is required');
  if (trimmed.includes('..') || trimmed.startsWith('/')) throw new Error('invalid state key');
  return trimmed;
}

function createSdk(cwd, pluginId, event) {
  const baseStateDir = stateDir(cwd);
  const dataPath = join(baseStateDir, 'hooks', 'plugins', pluginId, 'data.json');
  const logPath = join(dirname(baseStateDir), 'logs', `hooks-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const log = async (level, message, meta = {}) => {
    try {
      appendJsonLine(logPath, {
        timestamp: new Date().toISOString(),
        type: 'hook_plugin_log',
        plugin: pluginId,
        level,
        message,
        hook_event: event.event,
        ...safeObject(meta),
      });
    } catch {
      // Logging is fail-soft in the canonical SDK.
    }
  };
  const readSession = () => {
    const session = readJson(join(baseStateDir, 'session.json'));
    return typeof session?.session_id === 'string' && session.session_id.trim() ? session : null;
  };
  return {
    log: {
      info: (message, meta) => log('info', message, meta),
      warn: (message, meta) => log('warn', message, meta),
      error: (message, meta) => log('error', message, meta),
    },
    state: {
      read: async (key, fallback) => {
        const normalized = normalizeStateKey(key);
        const data = safeObject(readJson(dataPath, {}));
        return normalized in data ? data[normalized] : fallback;
      },
      write: async (key, value) => {
        const normalized = normalizeStateKey(key);
        writeJson(dataPath, { ...safeObject(readJson(dataPath, {})), [normalized]: value });
      },
      delete: async (key) => {
        const normalized = normalizeStateKey(key);
        const data = { ...safeObject(readJson(dataPath, {})) };
        if (normalized in data) {
          delete data[normalized];
          writeJson(dataPath, data);
        }
      },
      all: async () => safeObject(readJson(dataPath, {})),
    },
    owx: {
      session: { read: async () => readSession() },
      hud: {
        read: async () => {
          const session = readSession();
          return readJson(session
            ? join(baseStateDir, 'sessions', session.session_id, 'hud-state.json')
            : join(baseStateDir, 'hud-state.json'));
        },
      },
      updateCheck: { read: async () => readJson(join(baseStateDir, 'update-check.json')) },
    },
  };
}

async function readInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error('runner input too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const request = JSON.parse(await readInput());
  const cwd = String(request.cwd || process.cwd());
  const pluginId = String(request.pluginId || 'plugin');
  const pluginPath = String(request.pluginPath || '');
  if (!pluginPath || !existsSync(pluginPath)) throw new Error('plugin path missing');
  const loaded = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
  if (typeof loaded.onHookEvent !== 'function') throw new Error('missing_onHookEvent_export');
  await Promise.resolve(loaded.onHookEvent(request.event, createSdk(cwd, pluginId, request.event)));
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
