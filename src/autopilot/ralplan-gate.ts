import { existsSync, readFileSync } from 'node:fs';
import { buildRalplanConsensusGateFromSources, type RalplanConsensusGateEvidence } from '../ralplan/consensus-gate.js';
import {
  evaluateNativeSubagentRecovery,
  isUnsupportedNativeSubagentEvidenceForScope,
  nativeSubagentSupportPath,
  resolveNativeSubagentSupportStatus,
  type NativeSubagentRecoveryRecord,
} from '../subagents/tracker.js';

type JsonObject = Record<string, unknown>;

export interface AutopilotRalplanUltragoalGateInput {
  cwd: string;
  sessionId?: string;
  currentState?: JsonObject | null;
  nextState?: JsonObject | null;
}

export interface AutopilotRalplanUltragoalGateDecision {
  allowed: boolean;
  reason: string;
  evidence?: RalplanConsensusGateEvidence;
  nativeSubagentRecovery?: NativeSubagentRecoveryRecord;
}

function safeObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function nestedState(state: JsonObject | null | undefined): JsonObject | null {
  return safeObject(state?.state);
}

function handoffArtifacts(state: JsonObject | null | undefined): JsonObject | null {
  return safeObject(state?.handoff_artifacts) ?? safeObject(nestedState(state)?.handoff_artifacts);
}

function ralplanHandoff(state: JsonObject | null | undefined): JsonObject | null {
  return safeObject(handoffArtifacts(state)?.ralplan);
}

function readPersistedNativeSubagentSupport(cwd: string, sessionId: string): JsonObject | null {
  if (!sessionId) return null;
  const path = nativeSubagentSupportPath(cwd, sessionId);
  if (!existsSync(path)) return null;
  return safeObject(JSON.parse(readFileSync(path, 'utf-8')));
}

function gateSources(input: AutopilotRalplanUltragoalGateInput) {
  const sources: Array<{ source: string; value: unknown }> = [];
  for (const [label, state] of [
    ['next-autopilot-state', input.nextState],
    ['current-autopilot-state', input.currentState],
  ] as const) {
    if (!state) continue;
    sources.push({ source: label, value: state });
    const handoffs = handoffArtifacts(state);
    if (handoffs) sources.push({ source: `${label}:handoff_artifacts`, value: handoffs });
    const ralplan = ralplanHandoff(state);
    if (ralplan) sources.push({ source: `${label}:handoff_artifacts.ralplan`, value: ralplan });
  }
  return sources;
}

export function canAdvanceAutopilotRalplanToUltragoal(
  input: AutopilotRalplanUltragoalGateInput,
): AutopilotRalplanUltragoalGateDecision {
  const persistedSupport = input.sessionId
    ? readPersistedNativeSubagentSupport(input.cwd, input.sessionId)
    : null;
  const support = resolveNativeSubagentSupportStatus({
    persistedSupportBlocker: persistedSupport,
    cwd: input.cwd,
    sessionId: input.sessionId,
  });
  if (isUnsupportedNativeSubagentEvidenceForScope(support, {
    cwd: input.cwd,
    sessionId: input.sessionId,
  })) {
    const recovery = evaluateNativeSubagentRecovery('unsupported_native', 'blocked');
    return {
      allowed: false,
      reason: 'native subagent support is unavailable; ralplan must terminalize blocked or explicit_recovery_nonclean instead of handing off cleanly',
      nativeSubagentRecovery: recovery.record,
    };
  }

  const evidence = buildRalplanConsensusGateFromSources(gateSources(input), {
    cwd: input.cwd,
    sessionId: input.sessionId,
    requireNativeSubagents: true,
  });
  if (evidence.complete) {
    const recovery = evaluateNativeSubagentRecovery('supported_native', 'completed');
    return {
      allowed: true,
      reason: 'tracker-backed native ralplan architect and critic consensus evidence',
      evidence,
      nativeSubagentRecovery: recovery.record,
    };
  }
  return {
    allowed: false,
    reason: evidence.blockedReason === 'native_subagent_consensus_evidence_missing'
      ? 'ralplan consensus lacks tracker-backed native architect and critic lanes'
      : 'missing ralplan consensus gate with tracker-backed native architect and critic lanes',
    evidence,
  };
}

export function buildAutopilotRalplanUltragoalGateError(
  decision: AutopilotRalplanUltragoalGateDecision,
): string {
  const details = decision.evidence?.blockedDetails?.length
    ? ` Details: ${decision.evidence.blockedDetails.join('; ')}.`
    : '';
  const recovery = decision.nativeSubagentRecovery
    ? ` native_subagent_recovery=${JSON.stringify(decision.nativeSubagentRecovery)}.`
    : '';
  return `Cannot transition ralplan -> ultragoal: ${decision.reason}.${details}${recovery}`;
}
