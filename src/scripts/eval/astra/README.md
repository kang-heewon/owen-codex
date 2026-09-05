# Astra comparison evaluator

This test-only harness compares two real Codex runs across five fixed repository tasks. Build each package root before running it; the evaluator loads its generated `dist` modules and CLI entry directly.

```sh
cd /path/to/baseline && npm ci && npm run build
cd /path/to/candidate && npm ci && npm run build

npm run eval:astra -- \
  --baseline-package-root /path/to/baseline \
  --candidate-package-root /path/to/candidate \
  --baseline-model gpt-6-astra \
  --candidate-model gpt-6-astra \
  --baseline-effort xhigh \
  --candidate-effort xhigh \
  --codex-bin /path/to/astra-capable/codex \
  --output /path/to/result.json \
  --keep-workdirs
```

Exactly one of package root, model, or reasoning effort must differ. A package comparison therefore uses the same model and effort for both variants. Keep the Codex binary, authenticated account, host, and external conditions constant so the changed variable remains meaningful.

Each task runs in a temporary Git repository with its own `CODEX_HOME`. The harness installs the selected package's agents, hooks, skills, config, and an `owx` launcher there, then prepends that launcher's directory to `PATH`. It symlinks the selected `auth.json`; it does not read or copy the credentials or mutate the user's Codex or OWX installation. Use `--auth-file` to select the auth file explicitly and `--grader` to load another external grader.

Runs use persistent Codex threads so native collaboration can resolve the parent thread. Continuation tasks resume that same thread. The isolated root config fixes `sandbox_mode = "workspace-write"` and `approval_policy = "never"` so resumed turns retain the same repository permissions even though `exec resume` does not accept the initial sandbox argument.

Task status is `passed`, `task_failed`, or `infrastructure_failed`. Provider, authentication, unsupported-model, missing-hook, and process-launch failures remain infrastructure failures and are not graded as task failures. JSONL-derived metrics use `null` when evidence is unavailable. `--keep-workdirs` retains each repository and reports `repoPath` and `jsonlPath`; without it the harness removes temporary repositories after grading.

The runs consume real time and tokens and remain subject to provider latency, network state, and model variability. Usage covers the main exec JSONL stream; nested-agent internals or their usage may not be included. Tool counts include only completed JSONL items emitted by the selected Codex binary. A numeric delegation count means that many completed `spawn_agent` events were observed. If collaboration events are present but the main stream omits spawn events, delegation is `null` rather than zero. JSONL capture is limited to 16 MiB per Codex process; exceeding that limit is an infrastructure failure. The binary must support the configured model and effort; the harness never substitutes another model or authentication method.

The default code graders run hidden assertions against the resulting modules. The planning grader checks plan/test-spec artifacts, preservation of product files, a completed consensus gate in mode state or a JSON planning artifact, and a valid ralplan stop state: active `paused`/`paused_for_review` or inactive `complete`/`completed`. In-progress review and runtime-closure phases fail. `waiting_for_input` also fails this fixed task because its requirements are complete and asking a question does not finish the requested plan. The grader does not judge architectural quality or independently certify reviewer reasoning. Use an external grader for those claims, and repeat runs before drawing performance conclusions.
