# Technical Writing Preservation Cases

These cases show where general simplification would damage technical meaning.

## Normative Force

Source: “Clients MUST reject unsigned payloads and MAY retry a signed payload once.”

Wrong simplification: “Clients should reject unsigned payloads and can retry payloads.”

Preserve: `MUST`, `MAY`, signed/unsigned distinction, and the one-retry limit.

## Preconditions and Failure Mode

Source: “Call `session.close()` only after all pending writes complete; otherwise it returns `ERR_PENDING_WRITE`.”

Wrong simplification: “Call `session.close()` when finished.”

Preserve: ordering precondition, exact identifier, and explicit failure behavior.

## Compatibility Boundary

Source: “`--legacy-auth` is accepted in v2.8 but removed in v3.0.”

Wrong simplification: “The legacy authentication flag is deprecated.”

Preserve: exact flag, both versions, and accepted-versus-removed behavior.

## Deliberate Repetition

Source: “The server validates the envelope before decoding the payload. It validates the payload only after decoding.”

Wrong simplification: “The server validates the envelope and payload during decoding.”

Preserve: repeated `validates` because it distinguishes two objects and their order.

## Passive Voice

Source: “Tokens are invalidated 15 minutes after issuance.”

Wrong active rewrite: “The authentication service invalidates tokens 15 minutes after it issues them.”

Preserve: passive construction when the source does not establish the actor; the active rewrite invents one.

## Mechanism over Slogan

Source: “The gateway skips response caching when `entity_id` is present because the cache cannot invalidate that entity independently.”

Wrong simplification: “This approach improves cache reliability.”

Preserve: condition, identifier, behavior, and causal mechanism.

## Technical Translation

Source: “A Kafka consumer commits the offset after processing the event.”

Risky rewrite: “Kafka 소비자가 사건을 소비한 뒤 위치를 확정한다.”

Better for an engineering audience: “Kafka consumer는 이벤트를 처리한 뒤 offset을 commit한다.”

Preserve: recognized system concepts; do not force unfamiliar Korean terms merely to avoid English.

## Local Verification Boundary

Claim: “`npm run check` validates generated prompt contracts.”

Required evidence: inspect the repository script and run it locally when safe.

Not allowed: call a production service, add telemetry, or claim production validation. If local execution is unsafe or unavailable, report source inspection and the limitation.
