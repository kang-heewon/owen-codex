# Technical Writing Mode

Technical prose uses conservative `polish` behavior unless the user explicitly requests a rewrite.

## Priority

Apply this order:

```text
Correctness
→ Precision
→ Completeness for the requested scope
→ Traceability to code or evidence
→ Readability
→ Brevity
```

Never improve flow by removing preconditions, failure modes, exceptions, compatibility constraints, version distinctions, exact commands, identifiers, or deliberate repetition that prevents ambiguity.

## Normative Force

Preserve `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY`, and Korean requirement terms such as `반드시`, `금지`, `권장`, `가능`, and `선택 사항`, when they encode real requirements. Do not soften or strengthen them for conversational tone.

## Mechanism and Decisions

Prefer mechanism and cause/effect over slogans. Explain what triggers behavior and why instead of saying an approach “improves reliability and flexibility.” In decision records, keep problem or constraint, chosen approach, rationale, considered alternatives, failure behavior, and verification distinct. Do not compress them into a generic summary.

Use active voice when it clarifies actor or responsibility. Preserve passive voice when the actor is irrelevant, unknown, intentionally omitted, or the technical/scientific convention is clearer. Use headings, lists, tables, and code blocks only when they improve navigation or precision; short documents may be clearest as paragraphs.

## Identifiers, Examples, and Translation

Keep commands, code, API paths, config keys, schema fields, error names, UI labels, and version strings exact. Do not “clean up” code samples during a prose pass. For technical translation, preserve accepted terminology, protocol and product names, normative force, and source ambiguity. Retain English terminology when it is the natural vocabulary of the intended team.

## Local Verification

Verify claims, commands, and examples against repository-local source, tests, fixtures, builds, or syntax where feasible. Use source inspection for contracts that cannot safely be executed. Do not call production services, add telemetry, or gather operational samples merely to prove documentation. State what was locally verified and what could not be safely executed.

## Finalization

Lock facts and identifiers, improve structure and directness, remove only clear residue, inspect Korean register when applicable, and verify that no condition or exception weakened. Perform this bounded check in the owning writer workflow; do not recursively start another prose workflow.
