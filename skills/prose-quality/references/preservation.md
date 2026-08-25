# Preservation Contract

Preservation is the entry gate to editing, not a check performed after an unrestricted rewrite.

## Lock Before Editing

Identify and preserve these items unless the user explicitly authorizes a change:

- named entities; people, company, and product names;
- numbers, dates, units, URLs, citations, and version numbers;
- exact quotes and quoted UI labels;
- factual and causal claims, scope qualifiers, and explicit exceptions;
- legal or normative terms;
- uncertainty markers and evidential limits;
- the author's stance, opinion, and recognizable voice;
- code identifiers, API paths, CLI flags, config keys, schema fields, and error names.

Also protect fenced code, inline code, link targets, structured payloads, shell commands, SQL, regex, and citation markers byte-for-byte unless they are the requested editing target.

## Preserve Evidence Strength

Readability must not strengthen evidence. Do not change `may` to `will`, `appears to` to `is`, `likely` to `definitely`, or `we have not verified` to `works`. Preserve ambiguity when the source is ambiguous. If an edit might change technical or factual meaning, leave the phrase intact or describe the ambiguity in audit mode.

## Do Not Invent Specificity

Never supply a metric, benchmark, quote, customer story, factual example, personal experience, numerical improvement, concrete incident, or unstated reason merely to make a sentence vivid. Improve the wording within the available evidence or retain correct generality.

## Preserve Voice and Destination

Apply these priorities in order:

1. the user's requested tone and format;
2. the source author's voice and recognizable phrasing;
3. the destination's established convention;
4. general prose-quality preferences.

Do not turn a team message into a formal report, a personal note into corporate copy, or deliberate repetition into uniform prose simply because an alternative sounds tidier.

## Verification

After editing, compare source and result for entities, values, qualifiers, exceptions, stance, and protected spans. Confirm that deletions removed only redundancy, not a condition or evidence. Stop if the next edit would trade semantic confidence for stylistic preference.
