---
name: prose-quality
description: Review or edit English or Korean human-facing prose for clarity, natural language, and generated residue while preserving facts, intent, voice, formatting contracts, and domain terminology.
---

# Prose Quality

Improve prose without making it less true, less specific, or less recognizably the author's.

## When to Use

Use this skill when the user explicitly requests prose review or humanization, a parent workflow requests durable-prose finalization, or a substantial human-facing artifact needs the detailed editing contract.

Do not start a separate prose workflow for ordinary chat, code, machine payloads, raw logs, exact quotations, or every intermediate handoff. Technical documents use conservative `polish` behavior unless the user explicitly authorizes a rewrite.

## Choose a Mode

- **Audit:** Name concrete problems and point to affected spans. Do not rewrite unless asked.
- **Polish (default):** Make the minimum effective edits. Preserve working structure and voice.
- **Rewrite:** Restructure substantially only when the user clearly requests it. Keep the same factual and evidential limits; never invent specificity.

## Preservation-First Workflow

1. Identify the destination, audience, and purpose.
2. Lock protected material and preservation facts.
3. Read the whole passage for its voice and register.
4. Locate concrete quality problems.
5. Decide whether each candidate is actually a problem in context.
6. Make the minimum effective edits allowed by the selected mode.
7. Re-read for natural flow and, for Korean, domain-appropriate register.
8. Verify that meaning, evidence, voice, and protected regions remain intact.
9. Stop when the remaining differences are matters of taste rather than defects.

Read [references/preservation.md](references/preservation.md) before editing factual, quoted, mixed-format, or user-authored material. Read [references/patterns.md](references/patterns.md) when diagnosing generated residue. For Korean prose, read [references/korean.md](references/korean.md). For technical documentation or translation, read [references/technical-writing.md](references/technical-writing.md). Use [references/examples.md](references/examples.md) for compact application examples.

## Protected Content

Keep fenced code, inline code, URLs and link targets, exact quotations, citation markers, JSON/YAML/TOML, shell commands, SQL, regex, identifiers, API paths, CLI flags, config keys, and version strings byte-for-byte unchanged unless the user specifically asks to edit them. In mixed Markdown, edit the prose around these regions.

## Boundaries

- Treat patterns as contextual signals, never banned words or structures.
- Do not claim AI authorship, estimate AI probability, optimize for detector evasion, or produce a human/quality score.
- Do not add facts, metrics, quotations, examples presented as factual, personal experiences, or causal explanations absent from the source.
- Preserve ambiguity and uncertainty when the evidence is ambiguous or uncertain.
- For a literal translation, prioritize fidelity and requested structure. For an idiomatic translation, improve naturalness without changing meaning or accepted terminology.

The pass is complete once the meaning and evidence are unchanged, the destination and register fit, and no clear scaffolding or translationese harms readability. Do not keep editing to vary every sentence, eliminate every repeated word, or remove every listed pattern.
