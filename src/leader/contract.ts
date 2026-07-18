import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const NATIVE_SPAWN_TASK_NAME_PATTERN = /^[a-z0-9_]+$/;
export const ROLE_INTENT_CORRELATION_TOKEN_PATTERN = /^[a-z0-9]+$/;
export const ROLE_INTENT_SPAWN_TASK_NAME_PREFIX = 'omx_role_intent_';

export function buildRoleIntentSpawnTaskName(correlationToken: string): string {
  const normalized = correlationToken.trim();
  if (!ROLE_INTENT_CORRELATION_TOKEN_PATTERN.test(normalized)) {
    throw new Error('Invalid role-intent correlation token.');
  }
  return `${ROLE_INTENT_SPAWN_TASK_NAME_PREFIX}${normalized}`;
}

export function isAppCompatibleSpawnTaskName(taskName: string): boolean {
  return NATIVE_SPAWN_TASK_NAME_PATTERN.test(taskName);
}

export function parseRoleIntentCorrelationToken(taskName: unknown): string | undefined {
  if (typeof taskName !== 'string' || !taskName.startsWith(ROLE_INTENT_SPAWN_TASK_NAME_PREFIX)) return undefined;
  const token = taskName.slice(ROLE_INTENT_SPAWN_TASK_NAME_PREFIX.length);
  return ROLE_INTENT_CORRELATION_TOKEN_PATTERN.test(token) ? token : undefined;
}

export function canonicalizeOriginCwd(cwd: string | undefined): string | null {
  const trimmed = typeof cwd === 'string' ? cwd.trim() : '';
  if (!trimmed) return null;
  let resolved: string;
  try {
    resolved = resolve(trimmed);
  } catch {
    return null;
  }
  let prefix = resolved;
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(prefix);
      return suffix.length ? join(real, ...suffix) : real;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      const parent = dirname(prefix);
      if (parent === prefix) return resolved;
      suffix.unshift(basename(prefix));
      prefix = parent;
    }
  }
}
