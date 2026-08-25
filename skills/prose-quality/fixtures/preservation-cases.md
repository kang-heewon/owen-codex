# Preservation Cases

Each case records what a prose edit must lock before improving readability.

## Facts and Numbers

Source: “Acme shipped version 3.4 on 2026-08-12. The migration took 47 minutes.”

Allowed polish: “Acme shipped version 3.4 on 2026-08-12; the migration took 47 minutes.”

Must preserve: `Acme`, `3.4`, `2026-08-12`, `47 minutes`, and the fact that shipping and migration are separate claims.

## Scope and Exception

Source: “Caching is enabled for GET requests except when `preview=true`.”

Wrong simplification: “GET requests are cached.”

Must preserve: request method, exception, identifier, and exact value.

## Uncertainty

Source: “The timeout may be caused by connection-pool exhaustion, but we have not verified it.”

Wrong rewrite: “Connection-pool exhaustion causes the timeout.”

Must preserve: `may`, the hypothesis, and the lack of verification.

## Causal Claim

Source: “The worker retries because the upstream API can return HTTP 429.”

Wrong rewrite: “The worker retries to improve reliability.”

Must preserve: the stated cause and exact status code; do not replace mechanism with a slogan.

## Code and Structured Content

Source:

````markdown
Set `cache.max_age` in `config.toml`:

```toml
[cache]
max_age = 300
```

Then run `owx doctor --json`.
````

Allowed edit: Improve only surrounding prose.

Must preserve byte-for-byte: inline identifiers, filename, TOML payload, value, and command.

## URL and Citation

Source: “See [the migration guide](https://example.com/v2?mode=strict) for the compatibility table [RFC-12].”

Must preserve: link target and citation marker. Link text may change only if the request permits it and reference meaning remains the same.

## Exact Quote and Stance

Source: “The maintainer wrote, “This behavior is intentionally unsupported.” I think the restriction is reasonable.”

Wrong rewrite: “The maintainer said the behavior does not work, and the restriction is correct.”

Must preserve: the exact quotation, `intentionally unsupported`, and the author's opinion strength (`I think`, `reasonable`).

## Missing Specificity

Source: “The new path is faster in our local test.”

Wrong rewrite: “The new path is 40% faster in production.”

Allowed polish: “The new path was faster in our local test.”

Must preserve: local-only evidence and absence of a numeric result.
