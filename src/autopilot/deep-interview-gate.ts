type JsonObject = Record<string, unknown>;
type ExecutionContractStatus = 'absent' | 'valid' | 'invalid';
type ExecutionStride = 'task' | 'deliverable' | 'milestone';

export interface AutopilotDeepInterviewRalplanGateInput {
  cwd: string;
  sessionId?: string;
  baseStateDir?: string;
  currentState?: JsonObject | null;
  nextState?: JsonObject | null;
  deepInterviewState?: JsonObject | null;
}

export interface AutopilotDeepInterviewRalplanGateDecision {
  allowed: boolean;
  reason: string;
  evidence?: JsonObject;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function hasOwnKey(object: JsonObject | null | undefined, key: string): object is JsonObject {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

async function readDeepInterviewState(input: AutopilotDeepInterviewRalplanGateInput): Promise<JsonObject | null> {
  // Autopilot supervisor handoffs must not be driven by sibling workflow files.
  // Standalone deep-interview -> ralplan reconciliation passes its source state
  // explicitly; Autopilot state writes pass only current/next supervisor state.
  return input.deepInterviewState ?? null;
}

function nestedState(state: JsonObject | null | undefined): JsonObject | null {
  return safeObject(state?.state);
}

function handoffArtifacts(state: JsonObject | null | undefined): JsonObject | null {
  return safeObject(state?.handoff_artifacts) ?? safeObject(nestedState(state)?.handoff_artifacts);
}

function deepInterviewHandoff(state: JsonObject | null | undefined): unknown {
  return handoffArtifacts(state)?.deep_interview;
}

function deepInterviewGate(state: JsonObject | null | undefined): JsonObject | null {
  return safeObject(state?.deep_interview_gate) ?? safeObject(nestedState(state)?.deep_interview_gate);
}

function executionContractRequiredMarker(state: JsonObject | null | undefined): boolean {
  const nested = nestedState(state);
  const handoff = safeObject(deepInterviewHandoff(state));
  return executionContractRequiredValue(state)
    || executionContractRequiredValue(nested)
    || executionContractRequiredValue(deepInterviewGate(state))
    || executionContractRequiredValue(handoff);
}

function executionContractRequiredValue(state: JsonObject | null | undefined): boolean {
  return state?.execution_contract_required === true || state?.executionContractRequired === true;
}

function executionContractValue(contract: JsonObject, snakeKey: string, camelKey: string): string {
  return safeString(contract[snakeKey]) || safeString(contract[camelKey]);
}

function executionContractBoolean(contract: JsonObject, snakeKey: string, camelKey: string): boolean | undefined {
  if (typeof contract[snakeKey] === 'boolean') return contract[snakeKey];
  if (typeof contract[camelKey] === 'boolean') return contract[camelKey];
  return undefined;
}

function executionContractStride(contract: JsonObject): string {
  return executionContractValue(contract, 'execution_stride', 'executionStride') || safeString(contract.stride);
}

function executionContractCandidates(state: JsonObject | null | undefined): unknown[] {
  const candidates: unknown[] = [];
  if (hasOwnKey(state, 'execution_contract')) candidates.push(state.execution_contract);

  const nested = nestedState(state);
  if (hasOwnKey(nested, 'execution_contract')) candidates.push(nested.execution_contract);

  const handoff = safeObject(deepInterviewHandoff(state));
  if (hasOwnKey(handoff, 'execution_contract')) candidates.push(handoff.execution_contract);

  return candidates;
}

function isExecutionContractPlaceholder(contract: JsonObject): boolean {
  return executionContractStride(contract).length === 0
    && executionContractValue(contract, 'completion_unit', 'completionUnit').length === 0
    && executionContractValue(contract, 'stop_condition', 'stopCondition').length === 0;
}

function expectedExecutionContractFields(stride: ExecutionStride): {
  allowTaskShrink: boolean;
  acceptanceCoverageScope: string;
  shrinkPolicy: string;
} {
  if (stride === 'task') {
    return {
      allowTaskShrink: true,
      acceptanceCoverageScope: 'task',
      shrinkPolicy: 'allowed',
    };
  }
  if (stride === 'deliverable') {
    return {
      allowTaskShrink: false,
      acceptanceCoverageScope: 'deliverable',
      shrinkPolicy: 'ask_before_shrink',
    };
  }
  return {
    allowTaskShrink: false,
    acceptanceCoverageScope: 'milestone',
    shrinkPolicy: 'deny_unless_blocked',
  };
}

function isExecutionStride(value: string): value is ExecutionStride {
  return value === 'task' || value === 'deliverable' || value === 'milestone';
}

function isValidExecutionContract(contract: JsonObject): boolean {
  if (contract.version !== 1) return false;
  const stride = executionContractStride(contract);
  if (!isExecutionStride(stride)) return false;
  if (safeString(contract.source) !== 'deep-interview') return false;
  const selectedBy = executionContractValue(contract, 'selected_by', 'selectedBy');
  if (selectedBy !== 'user' && selectedBy !== 'default') return false;
  if (!executionContractValue(contract, 'completion_unit', 'completionUnit')) return false;
  if (!executionContractValue(contract, 'stop_condition', 'stopCondition')) return false;

  const expected = expectedExecutionContractFields(stride);
  return executionContractBoolean(contract, 'allow_task_shrink', 'allowTaskShrink') === expected.allowTaskShrink
    && executionContractValue(contract, 'acceptance_coverage_scope', 'acceptanceCoverageScope') === expected.acceptanceCoverageScope
    && executionContractValue(contract, 'shrink_policy', 'shrinkPolicy') === expected.shrinkPolicy;
}

function executionContractStatusForState(state: JsonObject | null | undefined): ExecutionContractStatus {
  const handoff = safeObject(deepInterviewHandoff(state));
  if (executionContractRequiredValue(handoff)) {
    if (hasOwnKey(handoff, 'execution_contract')) {
      const handoffContract = safeObject(handoff.execution_contract);
      if (
        !handoffContract
        || isExecutionContractPlaceholder(handoffContract)
        || !isValidExecutionContract(handoffContract)
      ) {
        return 'invalid';
      }
    }
  }

  let hasValidContract = false;
  for (const candidate of executionContractCandidates(state)) {
    const contract = safeObject(candidate);
    if (!contract) {
      return 'invalid';
    }
    if (isExecutionContractPlaceholder(contract)) return 'invalid';
    if (!isValidExecutionContract(contract)) return 'invalid';
    hasValidContract = true;
  }
  return hasValidContract ? 'valid' : 'absent';
}

function requiresExecutionContract(
  input: AutopilotDeepInterviewRalplanGateInput,
  deepState: JsonObject | null,
  gate: JsonObject,
): boolean {
  if (executionContractRequiredMarker(gate)) return true;
  return allCandidateStates(input, deepState).some((state) => executionContractRequiredMarker(state));
}

function executionContractStatusForHandoff(
  input: AutopilotDeepInterviewRalplanGateInput,
  deepState: JsonObject | null,
): ExecutionContractStatus {
  const states = input.nextState
    ? [input.nextState, deepState, input.currentState]
    : [deepState, input.currentState];
  for (const state of states) {
    const status = executionContractStatusForState(state);
    if (status !== 'absent') return status;
  }
  return 'absent';
}

function allCandidateStates(
  input: AutopilotDeepInterviewRalplanGateInput,
  deepState: JsonObject | null,
): Array<JsonObject | null | undefined> {
  return [input.nextState, input.currentState, deepState];
}

function firstGate(
  input: AutopilotDeepInterviewRalplanGateInput,
  deepState: JsonObject | null,
): JsonObject | null {
  const gates = allCandidateStates(input, deepState)
    .map((state) => deepInterviewGate(state))
    .filter((gate): gate is JsonObject => Boolean(gate));

  return gates.find((gate) => isSkipGate(gate, input.sessionId))
    ?? gates.find((gate) => isCompletionGate(gate, input, deepState))
    ?? gates[0]
    ?? null;
}

function hasNonEmptyObjectSummary(value: unknown): boolean {
  const object = safeObject(value);
  if (!object) return false;
  return ['summary', 'rationale', 'handoff_summary', 'artifact_path', 'path']
    .some((key) => safeString(object[key]).length > 0);
}

function completionRationaleExists(
  gate: JsonObject,
  input: AutopilotDeepInterviewRalplanGateInput,
  deepState: JsonObject | null,
): boolean {
  if (['rationale', 'completion_rationale', 'handoff_summary', 'summary', 'reason']
    .some((key) => safeString(gate[key]).length > 0)) {
    return true;
  }

  for (const state of allCandidateStates(input, deepState)) {
    const handoff = deepInterviewHandoff(state);
    if (typeof handoff === 'string' && handoff.trim()) return true;
    if (hasNonEmptyObjectSummary(handoff)) return true;
  }

  return false;
}

function normalizeStatus(value: unknown): string {
  return safeString(value).toLowerCase().replace(/_/g, '-');
}

function isCompletionGate(
  gate: JsonObject,
  input: AutopilotDeepInterviewRalplanGateInput,
  deepState: JsonObject | null,
): boolean {
  const status = normalizeStatus(gate.status);
  return (status === 'complete' || gate.complete === true)
    && completionRationaleExists(gate, input, deepState);
}

function isSkipGate(gate: JsonObject, sessionId?: string): boolean {
  const status = normalizeStatus(gate.status);
  const reason = safeString(gate.reason) || safeString(gate.skip_reason) || safeString(gate.rationale);
  const timestamp = safeString(gate.skipped_at) || safeString(gate.timestamp) || safeString(gate.updated_at);
  const source = safeString(gate.source);
  const gateSession = safeString(gate.session_id);
  const userAuthorized = gate.skip_authorized_by_user === true || gate.authorized_by_user === true;
  const sessionMatches = !sessionId || gateSession === sessionId;
  return status === 'skipped'
    && userAuthorized
    && reason.length > 0
    && timestamp.length > 0
    && source.length > 0
    && gateSession.length > 0
    && sessionMatches;
}

export async function canAdvanceAutopilotDeepInterviewToRalplan(
  input: AutopilotDeepInterviewRalplanGateInput,
): Promise<AutopilotDeepInterviewRalplanGateDecision> {
  const deepState = await readDeepInterviewState(input);
  const gate = firstGate(input, deepState);
  if (!gate) {
    return {
      allowed: false,
      reason: 'missing deep-interview completion/skip gate for ralplan handoff',
    };
  }

  if (requiresExecutionContract(input, deepState, gate)) {
    const executionContractStatus = executionContractStatusForHandoff(input, deepState);
    if (executionContractStatus !== 'valid') {
      return {
        allowed: false,
        reason: 'missing valid execution_contract for deep-interview ralplan handoff',
        evidence: { gate_status: gate.status, execution_contract_required: true, execution_contract_status: executionContractStatus },
      };
    }
  }

  if (isSkipGate(gate, input.sessionId)) {
    return {
      allowed: true,
      reason: 'explicit user-authorized deep-interview skip gate',
      evidence: { gate_status: 'skipped' },
    };
  }

  if (!isCompletionGate(gate, input, deepState)) {
    return {
      allowed: false,
      reason: 'deep-interview gate is not complete/skipped with required rationale',
      evidence: { gate_status: gate.status },
    };
  }

  return {
    allowed: true,
    reason: 'durable deep-interview completion gate',
    evidence: { gate_status: 'complete' },
  };
}

export function buildAutopilotDeepInterviewRalplanGateError(
  decision: AutopilotDeepInterviewRalplanGateDecision,
): string {
  return `Cannot transition deep-interview -> ralplan: ${decision.reason}.`;
}
