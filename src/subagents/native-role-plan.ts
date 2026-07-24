import { AGENT_DEFINITIONS } from '../agents/definitions.js';
import { getInstallableNativeAgentNames } from '../agents/policy.js';
import { readCatalogManifest } from '../catalog/reader.js';

export interface NativeRolePlan {
  availableAgentTypes: string[];
  recommendedAgentTypes: string[];
  summary: string;
}

export function listNativeAgentTypes(): string[] {
  return [...getInstallableNativeAgentNames(readCatalogManifest())]
    .filter((name) => Object.hasOwn(AGENT_DEFINITIONS, name))
    .sort();
}

function firstAvailable(
  available: ReadonlySet<string>,
  preferences: readonly string[],
): string | undefined {
  return preferences.find((role) => available.has(role));
}

export function buildNativeRolePlan(
  task: string,
  availableAgentTypes: readonly string[] = listNativeAgentTypes(),
): NativeRolePlan {
  const available = [...new Set(availableAgentTypes)].sort();
  const availableSet = new Set(available);
  const normalizedTask = task.toLowerCase();
  const recommendations = new Set<string>();

  let primaryPreferences = ['executor', 'debugger'];
  if (/(?:debug|regression|root cause|stack trace|flaky)/.test(normalizedTask)) {
    primaryPreferences = ['debugger', 'executor'];
  } else if (/(?:docs|documentation|readme|changelog|migration note)/.test(normalizedTask)) {
    primaryPreferences = ['writer', 'executor'];
  } else if (/(?:ui|ux|frontend|layout|css|design)/.test(normalizedTask)) {
    primaryPreferences = ['designer', 'executor'];
  }
  const primary = firstAvailable(availableSet, primaryPreferences) ?? available[0];
  if (primary) recommendations.add(primary);

  const verification = firstAvailable(availableSet, ['test-engineer', 'verifier', 'code-reviewer']);
  if (verification) recommendations.add(verification);
  const review = firstAvailable(availableSet, ['architect', 'code-reviewer', 'verifier']);
  if (review) recommendations.add(review);

  const recommendedAgentTypes = [...recommendations];
  return {
    availableAgentTypes: available,
    recommendedAgentTypes,
    summary: recommendedAgentTypes.length > 0
      ? `Use Codex native agent_type directly for bounded independent work: ${recommendedAgentTypes.join(', ')}.`
      : 'Continue in the leader because no installed native agent type is available.',
  };
}
