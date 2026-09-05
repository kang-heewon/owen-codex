import assert from "node:assert/strict";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { spawnPlatformCommandSync } from "../../utils/platform-command.js";
import { grade } from "../eval/astra/grader.js";
import {
	buildAstraCodexArgs,
	buildIsolatedCodexEnv,
	changedEvaluationVariable,
	installVariantNativeAgents,
	installVariantOwxLauncher,
	parseCodexJsonlMetrics,
	prepareVariantSessionInstructions,
	runAstraEvaluation,
} from "../eval/astra/index.js";
import { ASTRA_EVAL_TASKS } from "../eval/astra/tasks.js";

function spawnResult(
	overrides: Partial<SpawnSyncReturns<string>> = {},
): SpawnSyncReturns<string> {
	return {
		pid: 1,
		output: [],
		stdout: "",
		stderr: "",
		status: 0,
		signal: null,
		...overrides,
	} as SpawnSyncReturns<string>;
}

describe("Astra evaluation harness", () => {
	it("ships the five fixed task shapes, including strict workflow and continuation steering", () => {
		assert.deepEqual(
			ASTRA_EVAL_TASKS.map((task) => task.id),
			[
				"explanation-no-activation",
				"bug-repair",
				"multi-file-change",
				"explicit-strict-workflow",
				"continuation-steering",
			],
		);
		assert.match(ASTRA_EVAL_TASKS[3].prompts[0], /^\$ralplan/);
		assert.ok(ASTRA_EVAL_TASKS[3].files["src/cache.mjs"]);
		assert.ok(ASTRA_EVAL_TASKS[3].files["cache.test.mjs"]);
		assert.equal(ASTRA_EVAL_TASKS[4].prompts.length, 2);
		assert.match(ASTRA_EVAL_TASKS[4].prompts[1], /Steering update/);
	});

	it("requires a comparison to change exactly one variable", () => {
		const root = mkdtempSync(join(tmpdir(), "owx-astra-variables-"));
		const baselineRoot = join(root, "baseline");
		const candidateRoot = join(root, "candidate");
		const baselineAlias = join(root, "baseline-alias");
		try {
			mkdirSync(baselineRoot);
			mkdirSync(candidateRoot);
			symlinkSync(
				baselineRoot,
				baselineAlias,
				process.platform === "win32" ? "junction" : "dir",
			);
			assert.equal(
				changedEvaluationVariable(
					{ packageRoot: baselineRoot, model: "gpt-6-astra", effort: "high" },
					{ packageRoot: baselineAlias, model: "gpt-6-astra", effort: "xhigh" },
				),
				"effort",
			);
			assert.throws(
				() =>
					changedEvaluationVariable(
						{ packageRoot: baselineRoot, model: "a", effort: "high" },
						{ packageRoot: candidateRoot, model: "b", effort: "high" },
					),
				/change exactly one variable/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("extracts actual JSONL token, tool, and delegation evidence and leaves unknown fields null", () => {
		const metrics = parseCodexJsonlMetrics(
			[
				JSON.stringify({
					type: "item.started",
					item: { id: "item_1", type: "command_execution" },
				}),
				JSON.stringify({
					type: "item.updated",
					item: { id: "item_1", type: "command_execution" },
				}),
				JSON.stringify({
					type: "item.completed",
					item: {
						id: "item_1",
						type: "command_execution",
						command: "npm test",
					},
				}),
				JSON.stringify({
					type: "item.completed",
					item: { id: "item_2", type: "file_change" },
				}),
				JSON.stringify({
					type: "item.started",
					item: { id: "item_3", type: "collab_tool_call", tool: "spawn_agent" },
				}),
				JSON.stringify({
					type: "item.completed",
					item: { id: "item_3", type: "collab_tool_call", tool: "spawn_agent" },
				}),
				JSON.stringify({
					type: "item.completed",
					item: {
						id: "item_4",
						type: "collab_tool_call",
						tool: "send_message",
						prompt: "task",
					},
				}),
				JSON.stringify({
					type: "turn.completed",
					usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 4 },
				}),
				JSON.stringify({
					type: "turn.completed",
					usage: { input_tokens: 7, output_tokens: 2 },
				}),
			].join("\n"),
		);

		assert.deepEqual(metrics, {
			inputTokens: 17,
			cachedInputTokens: 3,
			outputTokens: 6,
			toolCalls: 4,
			delegations: 1,
		});
		assert.deepEqual(
			parseCodexJsonlMetrics(
				JSON.stringify({
					type: "item.started",
					item: { id: "item_1", type: "command_execution" },
				}),
			),
			{
				inputTokens: null,
				cachedInputTokens: null,
				outputTokens: null,
				toolCalls: null,
				delegations: null,
			},
		);
		assert.equal(
			parseCodexJsonlMetrics(
				JSON.stringify({
					type: "item.completed",
					item: { type: "agent_message" },
				}),
			).toolCalls,
			0,
		);
		assert.deepEqual(
			parseCodexJsonlMetrics(
				[
					JSON.stringify({
						type: "item.started",
						item: {
							id: "item_1",
							type: "collab_tool_call",
							tool: "wait",
						},
					}),
					JSON.stringify({
						type: "item.completed",
						item: {
							id: "item_1",
							type: "collab_tool_call",
							tool: "wait",
						},
					}),
				].join("\n"),
			),
			{
				inputTokens: null,
				cachedInputTokens: null,
				outputTokens: null,
				toolCalls: 1,
				delegations: null,
			},
		);
		assert.deepEqual(parseCodexJsonlMetrics("null\n[]\n42\nnot json"), {
			inputTokens: null,
			cachedInputTokens: null,
			outputTokens: null,
			toolCalls: null,
			delegations: null,
		});
	});

	it("installs native agents in an isolated subprocess", () => {
		const root = mkdtempSync(join(tmpdir(), "owx-astra-native-installer-"));
		const packageRoot = join(root, "variant");
		const agentsDir = join(root, "agents");
		const nativeConfigPath = join(
			packageRoot,
			"dist",
			"agents",
			"native-config.js",
		);
		try {
			mkdirSync(join(packageRoot, "dist", "agents"), { recursive: true });
			writeFileSync(join(packageRoot, "package.json"), '{"type":"module"}\n');
			writeFileSync(
				nativeConfigPath,
				[
					'import { mkdir, writeFile } from "node:fs/promises";',
					'import { join } from "node:path";',
					"export async function installNativeAgentConfigs(_root, { agentsDir }) {",
					"  await mkdir(agentsDir, { recursive: true });",
					'  await writeFile(join(agentsDir, "installed.json"), JSON.stringify({',
					"    model: process.env.OWX_AGENT_MODEL ?? null,",
					"    codexHome: process.env.CODEX_HOME ?? null,",
					"    cwd: process.cwd(),",
					"  }));",
					"}",
				].join("\n"),
			);

			installVariantNativeAgents(
				packageRoot,
				agentsDir,
				join(root, "runtime"),
				root,
				{
					PATH: process.env.PATH,
					OWX_AGENT_MODEL: "ambient-model",
					CODEX_HOME: "/ambient-codex",
				},
			);
			assert.deepEqual(
				JSON.parse(readFileSync(join(agentsDir, "installed.json"), "utf8")),
				{
					model: null,
					codexHome: join(root, "runtime"),
					cwd: realpathSync(root),
				},
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("generates the full variant overlay only for baseline-style default replacement", () => {
		const root = mkdtempSync(join(tmpdir(), "owx-astra-overlay-"));
		const packageRoot = join(root, "variant");
		const repoPath = join(root, "repo");
		const runtimeHome = join(root, "runtime");
		const overlayModulePath = join(
			packageRoot,
			"dist",
			"hooks",
			"agents-overlay.js",
		);
		try {
			mkdirSync(join(packageRoot, "dist", "hooks"), { recursive: true });
			mkdirSync(repoPath);
			writeFileSync(join(repoPath, "AGENTS.md"), "raw agents\n");
			writeFileSync(join(packageRoot, "package.json"), '{"type":"module"}\n');
			writeFileSync(
				overlayModulePath,
				[
					'import { mkdir, writeFile } from "node:fs/promises";',
					'import { join } from "node:path";',
					"export async function generateOverlay() { return `full overlay:${process.cwd()}`; }",
					"export async function writeSessionModelInstructionsFile(repoPath, sessionId, overlay) {",
					'  const path = join(repoPath, ".owx", `${sessionId}.md`);',
					'  await mkdir(join(repoPath, ".owx"), { recursive: true });',
					"  await writeFile(path, overlay);",
					"  return path;",
					"}",
				].join("\n"),
			);
			const baselineInject: typeof import("../../cli/index.js").injectModelInstructionsBypassArgs =
				(_cwd, args, _env, defaultFilePath) => [
					...args,
					"-c",
					`model_instructions_file=${JSON.stringify(defaultFilePath)}`,
				];
			const instructionsPath = prepareVariantSessionInstructions(
				packageRoot,
				repoPath,
				runtimeHome,
				"baseline-session",
				baselineInject,
			);
			assert.ok(instructionsPath);
			assert.notEqual(instructionsPath, join(repoPath, "AGENTS.md"));
			assert.equal(
				readFileSync(instructionsPath, "utf8"),
				`full overlay:${realpathSync(repoPath)}`,
			);
			const args = buildAstraCodexArgs(
				repoPath,
				{
					name: "baseline",
					packageRoot,
					model: "gpt-6-astra",
					effort: "xhigh",
				},
				join(repoPath, "last-message.txt"),
				"explain",
				baselineInject,
				instructionsPath,
			);
			assert.ok(
				args.includes(
					`model_instructions_file=${JSON.stringify(instructionsPath)}`,
				),
			);

			const candidatePath = prepareVariantSessionInstructions(
				join(root, "missing-candidate-package"),
				repoPath,
				runtimeHome,
				"candidate-session",
				(_cwd, args) => [...args],
			);
			assert.equal(candidatePath, undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("isolates Codex state and strips inherited OWX runtime variables", () => {
		const env = buildIsolatedCodexEnv(
			{
				PATH: "/bin",
				CODEX_HOME: "/real-codex",
				CODEX_SQLITE_HOME: "/real-sqlite",
				CODEX_SESSION_ID: "ambient-codex-session",
				CODEX_THREAD_ID: "ambient-codex-thread",
				CODEX_CI: "1",
				OWX_ROOT: "/ambient-owx",
				OWX_SESSION_ID: "ambient-session",
			},
			"/isolated-codex",
		);

		assert.deepEqual(env, {
			PATH: `/isolated-codex/bin${delimiter}/bin`,
			CODEX_HOME: "/isolated-codex",
			CODEX_SQLITE_HOME: "/isolated-codex",
		});
	});

	it("routes owx through the selected package root and provides a Windows launcher", async () => {
		const root = mkdtempSync(join(tmpdir(), "owx-astra-launcher-"));
		const packageRoot = join(root, "variant package");
		const runtimeHome = join(root, "runtime");
		const entry = join(packageRoot, "dist", "cli", "owx.js");
		try {
			mkdirSync(join(packageRoot, "dist", "cli"), { recursive: true });
			writeFileSync(entry, `console.log(${JSON.stringify(packageRoot)});\n`);
			const launcherPath = await installVariantOwxLauncher(
				runtimeHome,
				packageRoot,
			);
			const env = buildIsolatedCodexEnv(
				{ PATH: process.env.PATH },
				runtimeHome,
			);
			const { result } = spawnPlatformCommandSync(
				"owx",
				[],
				{ encoding: "utf8", env },
				process.platform,
				env,
			);

			assert.equal(result.status, 0, result.stderr);
			assert.equal(result.stdout.trim(), packageRoot);
			assert.equal(
				launcherPath,
				join(
					runtimeHome,
					"bin",
					process.platform === "win32" ? "owx.cmd" : "owx",
				),
			);

			const windowsLauncher = await installVariantOwxLauncher(
				runtimeHome,
				packageRoot,
				"win32",
			);
			const windowsContents = readFileSync(windowsLauncher, "utf8");
			assert.match(windowsContents, /^@echo off\r?\n/);
			assert.ok(windowsContents.includes(entry));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("runs isolated baseline and candidate fixtures with direct Codex args and distinguishes task failure", async () => {
		const seenArgs: string[][] = [];
		const task = ASTRA_EVAL_TASKS[0];
		const authRoot = mkdtempSync(join(tmpdir(), "owx-astra-auth-"));
		const authFile = join(authRoot, "auth.json");
		writeFileSync(authFile, '{"token":"test-only"}\n');
		const result = await runAstraEvaluation(
			{
				baseline: {
					packageRoot: resolve("."),
					model: "gpt-6-astra",
					effort: "high",
				},
				candidate: {
					packageRoot: resolve("."),
					model: "gpt-6-astra",
					effort: "xhigh",
				},
				tasks: [task],
				keepWorkdirs: true,
				authFile,
				grader: ({ repoPath }) => ({
					pass: false,
					details: { isolated: repoPath.includes("owx-astra-") },
				}),
			},
			{
				requireHookEvidence: false,
				executeCodex: (args) => {
					seenArgs.push(args);
					const outputIndex = args.indexOf("--output-last-message");
					writeFileSync(args[outputIndex + 1], "explanation");
					return spawnResult({
						stdout: `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 2 } })}\n`,
					});
				},
			},
		);

		assert.equal(result.changedVariable, "effort");
		assert.deepEqual(
			result.variants.map((variant) => variant.tasks[0].status),
			["task_failed", "task_failed"],
		);
		assert.equal(seenArgs.length, 2);
		for (const variant of result.variants) {
			const taskResult = variant.tasks[0];
			assert.ok(taskResult.repoPath);
			assert.ok(taskResult.jsonlPath && existsSync(taskResult.jsonlPath));
			const hooksConfig = JSON.parse(
				readFileSync(
					join(taskResult.repoPath, ".git", "owx-codex-home", "hooks.json"),
					"utf8",
				),
			) as Record<string, unknown>;
			assert.ok(hooksConfig.hooks);
			assert.equal("state" in hooksConfig, false);
			const runtimeConfig = readFileSync(
				join(taskResult.repoPath, ".git", "owx-codex-home", "config.toml"),
				"utf8",
			);
			assert.match(runtimeConfig, /^sandbox_mode = "workspace-write"$/m);
			assert.match(runtimeConfig, /^approval_policy = "never"$/m);
			assert.equal(
				existsSync(
					join(taskResult.repoPath, ".git", "owx-codex-home", "auth.json"),
				),
				false,
			);
			rmSync(taskResult.repoPath, { recursive: true, force: true });
		}
		rmSync(authRoot, { recursive: true, force: true });
		for (const args of seenArgs) {
			assert.ok(!args.includes("--ignore-user-config"));
			assert.ok(!args.includes("--ephemeral"));
			assert.ok(args.includes(task.prompts[0]));
		}
	});

	it("classifies a Codex launch failure as infrastructure failure without grading it", async () => {
		let graderCalls = 0;
		const result = await runAstraEvaluation(
			{
				baseline: {
					packageRoot: resolve("."),
					model: "gpt-6-astra",
					effort: "high",
				},
				candidate: {
					packageRoot: resolve("."),
					model: "gpt-6-astra",
					effort: "xhigh",
				},
				tasks: [ASTRA_EVAL_TASKS[0]],
				grader: () => {
					graderCalls += 1;
					return { pass: true };
				},
			},
			{
				executeCodex: () =>
					spawnResult({ status: 1, stderr: "provider unavailable" }),
			},
		);

		assert.equal(graderCalls, 0);
		assert.deepEqual(
			result.variants.map((variant) => variant.tasks[0].status),
			["infrastructure_failed", "infrastructure_failed"],
		);
		assert.match(
			result.variants[0].tasks[0].infrastructureError ?? "",
			/provider unavailable/,
		);
	});

	it("continues steering through the same persisted Codex thread", async () => {
		const seenArgs: string[][] = [];
		const task = ASTRA_EVAL_TASKS.find(
			(entry) => entry.id === "continuation-steering",
		)!;
		await runAstraEvaluation(
			{
				baseline: {
					packageRoot: resolve("."),
					model: "gpt-6-astra",
					effort: "high",
				},
				candidate: {
					packageRoot: resolve("."),
					model: "gpt-6-astra",
					effort: "xhigh",
				},
				tasks: [task],
				grader: () => ({ pass: true }),
			},
			{
				requireHookEvidence: false,
				executeCodex: (args) => {
					seenArgs.push(args);
					const outputIndex = args.indexOf("--output-last-message");
					writeFileSync(args[outputIndex + 1], "continued");
					return spawnResult({
						stdout: `${JSON.stringify({ type: "thread.started", thread_id: "thread-123" })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })}\n`,
					});
				},
			},
		);

		assert.equal(seenArgs.length, 4);
		for (const [initial, resumed] of [
			[seenArgs[0], seenArgs[1]],
			[seenArgs[2], seenArgs[3]],
		]) {
			assert.ok(!initial.includes("--ephemeral"));
			assert.deepEqual(resumed.slice(0, 4), [
				"exec",
				"resume",
				"thread-123",
				"--ignore-rules",
			]);
			assert.ok(!resumed.includes("--ephemeral"));
			assert.ok(resumed.includes(task.prompts[1]));
		}
	});

	it("default hidden graders reject shallow fixtures and accept the required behavior", () => {
		const root = mkdtempSync(join(tmpdir(), "owx-astra-graders-"));
		const task = (id: string) =>
			ASTRA_EVAL_TASKS.find((entry) => entry.id === id)!;
		const context = (id: string) => ({
			task: task(id),
			repoPath: root,
			lastMessage: "done",
			jsonl: "",
		});
		try {
			spawnSync("git", ["init"], { cwd: root });
			writeFileSync(
				join(root, "sum.mjs"),
				"export const sum = values => values.reduce((a, b) => a - b, 0);\n",
			);
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(
				join(root, "src", "store.mjs"),
				"export const records = new Map();\n",
			);
			writeFileSync(
				join(root, "src", "user.mjs"),
				"import { records } from './store.mjs'; export const saveUser = u => records.set(u.id, u);\n",
			);
			writeFileSync(
				join(root, "slug.mjs"),
				"export const slug = value => value.toLowerCase().replaceAll(' ', '-');\n",
			);
			spawnSync("git", ["add", "."], { cwd: root });
			spawnSync(
				"git",
				[
					"-c",
					"user.name=eval",
					"-c",
					"user.email=eval@invalid",
					"commit",
					"-m",
					"base",
				],
				{ cwd: root },
			);

			assert.equal(grade(context("explanation-no-activation")).pass, true);
			mkdirSync(join(root, ".owx", "state"), { recursive: true });
			const accidentalWorkflow = join(
				root,
				".owx",
				"state",
				"autopilot-state.json",
			);
			writeFileSync(
				accidentalWorkflow,
				JSON.stringify({ mode: "autopilot", active: false }),
			);
			assert.equal(grade(context("explanation-no-activation")).pass, false);
			rmSync(accidentalWorkflow);
			assert.equal(grade(context("bug-repair")).pass, false);
			writeFileSync(
				join(root, "sum.mjs"),
				"export const sum = values => values.reduce((a, b) => a + b, 0);\n",
			);
			assert.equal(grade(context("bug-repair")).pass, true);

			writeFileSync(
				join(root, "src", "find-user.mjs"),
				"import { records } from './store.mjs'; export const findUser = id => records.get(id);\n",
			);
			assert.equal(grade(context("multi-file-change")).pass, false);
			writeFileSync(
				join(root, "src", "user.mjs"),
				"import { records } from './store.mjs'; export const saveUser = u => records.set(u.id, u); export { findUser } from './find-user.mjs';\n",
			);
			const multiGrade = grade(context("multi-file-change"));
			assert.equal(multiGrade.pass, true, JSON.stringify(multiGrade.details));

			assert.equal(grade(context("continuation-steering")).pass, false);
			writeFileSync(
				join(root, "slug.mjs"),
				"export const slug = value => value.toLowerCase().replace(/\\s+/g, '-');\n",
			);
			assert.equal(grade(context("continuation-steering")).pass, true);
			spawnSync("git", ["add", "."], { cwd: root });
			spawnSync(
				"git",
				[
					"-c",
					"user.name=eval",
					"-c",
					"user.email=eval@invalid",
					"commit",
					"-m",
					"completed product fixtures",
				],
				{ cwd: root },
			);

			mkdirSync(join(root, ".owx", "plans"), { recursive: true });
			mkdirSync(join(root, ".owx", "state"), { recursive: true });
			writeFileSync(join(root, ".owx", "plans", "prd-cache.md"), "");
			writeFileSync(join(root, ".owx", "plans", "test-spec-cache.md"), "");
			assert.equal(grade(context("explicit-strict-workflow")).pass, false);
			writeFileSync(
				join(root, ".owx", "plans", "prd-cache.md"),
				`# Requirements\n${"Requirement and constraint with acceptance criteria. ".repeat(8)}`,
			);
			writeFileSync(
				join(root, ".owx", "plans", "test-spec-cache.md"),
				`# Test scenarios\n${"Verification scenario and command evidence. ".repeat(6)}`,
			);
			writeFileSync(
				join(root, ".owx", "state", "ralplan-state.json"),
				JSON.stringify({
					mode: "ralplan",
					active: true,
					current_phase: "critic_review",
				}),
			);
			assert.equal(grade(context("explicit-strict-workflow")).pass, false);
			writeFileSync(
				join(root, ".owx", "state", "ralplan-state.json"),
				JSON.stringify({
					mode: "ralplan",
					active: true,
					current_phase: "waiting_for_runtime_closure",
					planning_complete: true,
					ralplan_consensus_gate: { complete: true },
				}),
			);
			assert.equal(grade(context("explicit-strict-workflow")).pass, false);
			writeFileSync(
				join(root, ".owx", "state", "ralplan-state.json"),
				JSON.stringify({
					mode: "ralplan",
					active: true,
					current_phase: "paused_for_review",
					ralplan_consensus_gate: { complete: true },
				}),
			);
			assert.equal(grade(context("explicit-strict-workflow")).pass, true);
			writeFileSync(
				join(root, ".owx", "state", "ralplan-state.json"),
				JSON.stringify({
					mode: "ralplan",
					active: true,
					current_phase: "waiting_for_input",
					planning_complete: true,
					ralplan_consensus_gate: { complete: true },
				}),
			);
			assert.equal(grade(context("explicit-strict-workflow")).pass, false);
			writeFileSync(
				join(root, ".owx", "state", "ralplan-state.json"),
				JSON.stringify({
					mode: "ralplan",
					active: true,
					current_phase: "paused",
				}),
			);
			assert.equal(grade(context("explicit-strict-workflow")).pass, false);
			writeFileSync(
				join(root, ".owx", "plans", "consensus-evidence.json"),
				JSON.stringify({ ralplan_consensus_gate: { complete: true } }),
			);
			assert.equal(grade(context("explicit-strict-workflow")).pass, true);
			writeFileSync(
				join(root, ".owx", "state", "ralplan-state.json"),
				JSON.stringify({
					mode: "ralplan",
					active: false,
					current_phase: "complete",
				}),
			);
			assert.equal(grade(context("explicit-strict-workflow")).pass, true);
			writeFileSync(
				join(root, "slug.mjs"),
				"export const slug = () => 'changed';\n",
			);
			assert.equal(grade(context("explicit-strict-workflow")).pass, false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
