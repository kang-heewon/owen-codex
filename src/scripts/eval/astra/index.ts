#!/usr/bin/env node
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { redactAuthSecrets } from "../../../auth/redact.js";
import {
	type ConfiguredAgentReasoningEffort,
	parseConfiguredAgentReasoningEffort,
} from "../../../config/models.js";
import { ASTRA_EVAL_TASKS, type AstraEvalTask } from "./tasks.js";

export interface AstraEvalVariant {
	name: "baseline" | "candidate";
	packageRoot: string;
	model: string;
	effort: ConfiguredAgentReasoningEffort;
}

export interface AstraJsonlMetrics {
	inputTokens: number | null;
	cachedInputTokens: number | null;
	outputTokens: number | null;
	toolCalls: number | null;
	delegations: number | null;
}

export interface AstraGrade {
	pass: boolean;
	score?: number;
	details?: unknown;
}

export interface AstraTaskResult {
	taskId: string;
	status: "passed" | "task_failed" | "infrastructure_failed";
	grade: AstraGrade | null;
	durationMs: number;
	metrics: AstraJsonlMetrics;
	infrastructureError: string | null;
	repoPath?: string;
	jsonlPath?: string;
}

export interface AstraEvaluationResult {
	changedVariable: "packageRoot" | "model" | "effort";
	variants: Array<{
		variant: AstraEvalVariant;
		tasks: AstraTaskResult[];
	}>;
}

export interface AstraGraderContext {
	task: AstraEvalTask;
	repoPath: string;
	lastMessage: string;
	jsonl: string;
}

export type AstraGrader = (
	context: AstraGraderContext,
) => Promise<AstraGrade> | AstraGrade;
type CodexExecutor = (
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
) => SpawnSyncReturns<string>;
type InstructionsInjector =
	typeof import("../../../cli/index.js").injectModelInstructionsBypassArgs;

const ZERO_UNKNOWN_METRICS: AstraJsonlMetrics = {
	inputTokens: null,
	cachedInputTokens: null,
	outputTokens: null,
	toolCalls: null,
	delegations: null,
};

export function parseCodexJsonlMetrics(jsonl: string): AstraJsonlMetrics {
	let sawEvent = false;
	let sawCompletedItemSchema = false;
	let inputTokens = 0;
	let cachedInputTokens = 0;
	let outputTokens = 0;
	let sawInputTokens = false;
	let sawCachedInputTokens = false;
	let sawOutputTokens = false;
	let toolCalls = 0;
	let delegations = 0;
	let sawCollaborationEvent = false;

	for (const line of jsonl.split(/\r?\n/)) {
		if (!line.trim()) continue;
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (!event || typeof event !== "object" || Array.isArray(event)) continue;
		sawEvent = true;
		const usage = event.usage;
		if (usage && typeof usage === "object" && !Array.isArray(usage)) {
			const record = usage as Record<string, unknown>;
			if (typeof record.input_tokens === "number") {
				inputTokens += record.input_tokens;
				sawInputTokens = true;
			}
			if (typeof record.cached_input_tokens === "number") {
				cachedInputTokens += record.cached_input_tokens;
				sawCachedInputTokens = true;
			}
			if (typeof record.output_tokens === "number") {
				outputTokens += record.output_tokens;
				sawOutputTokens = true;
			}
		}
		const item = event.item;
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const itemType = typeof record.type === "string" ? record.type : "";
		if (itemType === "collab_tool_call") sawCollaborationEvent = true;
		if (event.type !== "item.completed") continue;
		sawCompletedItemSchema = true;
		if (
			[
				"command_execution",
				"file_change",
				"mcp_tool_call",
				"collab_tool_call",
				"web_search",
				"tool_call",
			].includes(itemType)
		) {
			toolCalls += 1;
			if (itemType === "collab_tool_call" && record.tool === "spawn_agent")
				delegations += 1;
		}
	}

	return {
		inputTokens: sawInputTokens ? inputTokens : null,
		cachedInputTokens: sawCachedInputTokens ? cachedInputTokens : null,
		outputTokens: sawOutputTokens ? outputTokens : null,
		toolCalls: sawEvent && sawCompletedItemSchema ? toolCalls : null,
		delegations:
			sawEvent && sawCompletedItemSchema
				? delegations > 0 || !sawCollaborationEvent
					? delegations
					: null
				: null,
	};
}

export function changedEvaluationVariable(
	baseline: Omit<AstraEvalVariant, "name">,
	candidate: Omit<AstraEvalVariant, "name">,
): AstraEvaluationResult["changedVariable"] {
	const comparableBaseline = {
		...baseline,
		packageRoot: realpathSync(baseline.packageRoot),
	};
	const comparableCandidate = {
		...candidate,
		packageRoot: realpathSync(candidate.packageRoot),
	};
	const changed = (["packageRoot", "model", "effort"] as const).filter(
		(key) => comparableBaseline[key] !== comparableCandidate[key],
	);
	if (changed.length !== 1) {
		throw new Error(
			`Astra evaluation must change exactly one variable; changed: ${changed.join(", ") || "none"}`,
		);
	}
	return changed[0];
}

function quoteForPosixShell(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function quoteForWindowsBatch(value: string): string {
	return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

export async function installVariantOwxLauncher(
	runtimeCodexHome: string,
	packageRoot: string,
	platform: NodeJS.Platform = process.platform,
): Promise<string> {
	const owxEntry = join(packageRoot, "dist", "cli", "owx.js");
	if (!existsSync(owxEntry))
		throw new Error(`package root is missing dist/cli/owx.js: ${packageRoot}`);

	const binDir = join(runtimeCodexHome, "bin");
	await mkdir(binDir, { recursive: true });
	if (platform === "win32") {
		const launcherPath = join(binDir, "owx.cmd");
		await writeFile(
			launcherPath,
			`@echo off\r\n${quoteForWindowsBatch(process.execPath)} ${quoteForWindowsBatch(owxEntry)} %*\r\n`,
		);
		return launcherPath;
	}

	const launcherPath = join(binDir, "owx");
	await writeFile(
		launcherPath,
		`#!/bin/sh\nexec ${quoteForPosixShell(process.execPath)} ${quoteForPosixShell(owxEntry)} "$@"\n`,
	);
	await chmod(launcherPath, 0o755);
	return launcherPath;
}

export function installVariantNativeAgents(
	packageRoot: string,
	agentsDir: string,
	runtimeCodexHome: string,
	cwd: string,
	sourceEnv: NodeJS.ProcessEnv = process.env,
): void {
	const nativeConfigPath = join(
		packageRoot,
		"dist",
		"agents",
		"native-config.js",
	);
	if (!existsSync(nativeConfigPath)) {
		throw new Error(
			`package root is missing dist/agents/native-config.js: ${packageRoot}`,
		);
	}
	const installer = [
		"const [moduleUrl, packageRoot, agentsDir] = process.argv.slice(1);",
		"const { installNativeAgentConfigs } = await import(moduleUrl);",
		"await installNativeAgentConfigs(packageRoot, { agentsDir, force: true });",
	].join("\n");
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			installer,
			pathToFileURL(nativeConfigPath).href,
			packageRoot,
			agentsDir,
		],
		{
			cwd,
			encoding: "utf8",
			env: buildIsolatedCodexEnv(sourceEnv, runtimeCodexHome),
			timeout: 30_000,
		},
	);
	if (result.error || result.status !== 0) {
		throw new Error(
			result.error?.message ??
				(result.stderr.trim() ||
					`native agent installer exited ${result.status}`),
		);
	}
}

function hasModelInstructionsFileArg(args: string[]): boolean {
	return args.some((arg, index) => {
		if (arg === "-c" || arg === "--config") {
			return /^model_instructions_file\s*=/.test(args[index + 1] ?? "");
		}
		return /^(?:-c|--config)=model_instructions_file\s*=/.test(arg);
	});
}

export function variantInjectsDefaultModelInstructions(
	repoPath: string,
	injectInstructions: InstructionsInjector,
): boolean {
	return hasModelInstructionsFileArg(
		injectInstructions(repoPath, ["exec"], {}, join(repoPath, "AGENTS.md")),
	);
}

export function prepareVariantSessionInstructions(
	packageRoot: string,
	repoPath: string,
	runtimeCodexHome: string,
	sessionId: string,
	injectInstructions: InstructionsInjector,
): string | undefined {
	if (!variantInjectsDefaultModelInstructions(repoPath, injectInstructions)) {
		return undefined;
	}

	const overlayModulePath = join(
		packageRoot,
		"dist",
		"hooks",
		"agents-overlay.js",
	);
	if (!existsSync(overlayModulePath)) {
		throw new Error(
			`package root is missing dist/hooks/agents-overlay.js: ${packageRoot}`,
		);
	}
	const generator = [
		"const [moduleUrl, repoPath, sessionId] = process.argv.slice(1);",
		"const { generateOverlay, writeSessionModelInstructionsFile } = await import(moduleUrl);",
		"const overlay = await generateOverlay(repoPath, sessionId);",
		"process.stdout.write(await writeSessionModelInstructionsFile(repoPath, sessionId, overlay));",
	].join("\n");
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			generator,
			pathToFileURL(overlayModulePath).href,
			repoPath,
			sessionId,
		],
		{
			cwd: repoPath,
			encoding: "utf8",
			env: buildIsolatedCodexEnv(process.env, runtimeCodexHome),
			timeout: 30_000,
		},
	);
	if (result.error || result.status !== 0) {
		throw new Error(
			result.error?.message ??
				(result.stderr.trim() ||
					`session instructions generator exited ${result.status}`),
		);
	}
	const instructionsPath = result.stdout.trim();
	if (!isAbsolute(instructionsPath) || !existsSync(instructionsPath)) {
		throw new Error(
			"session instructions generator did not return an existing absolute path",
		);
	}
	return instructionsPath;
}

async function writeTaskFixture(
	repoPath: string,
	task: AstraEvalTask,
	variant: AstraEvalVariant,
): Promise<string> {
	for (const [relativePath, content] of Object.entries(task.files)) {
		const target = join(repoPath, relativePath);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content);
	}
	const agentsTemplate = join(variant.packageRoot, "templates", "AGENTS.md");
	if (!existsSync(agentsTemplate))
		throw new Error(
			`package root is missing templates/AGENTS.md: ${variant.packageRoot}`,
		);
	await writeFile(
		join(repoPath, "AGENTS.md"),
		await readFile(agentsTemplate, "utf8"),
	);

	for (const args of [
		["init"],
		["add", "."],
		[
			"-c",
			"user.name=OWX Astra Eval",
			"-c",
			"user.email=astra-eval@invalid",
			"commit",
			"-m",
			"fixture",
		],
	]) {
		const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
		if (result.status !== 0)
			throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
	}

	const runtimeCodexHome = join(repoPath, ".git", "owx-codex-home");
	const agentsDir = join(runtimeCodexHome, "agents");
	await mkdir(runtimeCodexHome, { recursive: true });
	await writeFile(
		join(runtimeCodexHome, "config.toml"),
		[
			`model = ${JSON.stringify(variant.model)}`,
			`model_reasoning_effort = ${JSON.stringify(variant.effort)}`,
			'sandbox_mode = "workspace-write"',
			'approval_policy = "never"',
			"",
			"[features]",
			"hooks = true",
			"multi_agent = true",
			"goals = true",
			"",
			`[projects.${JSON.stringify(repoPath)}]`,
			'trust_level = "trusted"',
			"",
		].join("\n"),
	);
	const hooksModulePath = join(
		variant.packageRoot,
		"dist",
		"config",
		"codex-hooks.js",
	);
	if (!existsSync(hooksModulePath)) {
		throw new Error(
			`package root must contain built dist agent and hook modules: ${variant.packageRoot}`,
		);
	}
	const hooks = (await import(pathToFileURL(hooksModulePath).href)) as {
		buildManagedCodexHooksConfig: typeof import("../../../config/codex-hooks.js").buildManagedCodexHooksConfig;
	};
	installVariantNativeAgents(
		variant.packageRoot,
		agentsDir,
		runtimeCodexHome,
		repoPath,
	);
	await writeFile(
		join(runtimeCodexHome, "hooks.json"),
		`${JSON.stringify(hooks.buildManagedCodexHooksConfig(variant.packageRoot), null, 2)}\n`,
	);
	const skillsSource = join(variant.packageRoot, "skills");
	if (!existsSync(skillsSource))
		throw new Error(`package root is missing skills/: ${variant.packageRoot}`);
	await cp(skillsSource, join(runtimeCodexHome, "skills"), { recursive: true });
	await installVariantOwxLauncher(runtimeCodexHome, variant.packageRoot);
	return runtimeCodexHome;
}

export function buildAstraCodexArgs(
	repoPath: string,
	variant: AstraEvalVariant,
	lastMessagePath: string,
	prompt: string,
	injectInstructions: InstructionsInjector,
	defaultInstructionsPath: string,
	resumeThreadId?: string,
): string[] {
	const common = [
		"--ignore-rules",
		"--dangerously-bypass-hook-trust",
		"--json",
		"--model",
		variant.model,
		"-c",
		`model_reasoning_effort=${JSON.stringify(variant.effort)}`,
		"--output-last-message",
		lastMessagePath,
		prompt,
	];
	const base = resumeThreadId
		? ["exec", "resume", resumeThreadId, ...common]
		: ["exec", "--sandbox", "workspace-write", "-C", repoPath, ...common];
	return injectInstructions(repoPath, base, {}, defaultInstructionsPath);
}

function threadIdFromJsonl(jsonl: string): string | undefined {
	for (const line of jsonl.split(/\r?\n/)) {
		try {
			const event = JSON.parse(line) as { type?: unknown; thread_id?: unknown };
			if (
				event.type === "thread.started" &&
				typeof event.thread_id === "string"
			)
				return event.thread_id;
		} catch {
			continue;
		}
	}
	return undefined;
}

async function runTask(
	variant: AstraEvalVariant,
	task: AstraEvalTask,
	grader: AstraGrader,
	executeCodex: CodexExecutor,
	keepWorkdirs: boolean,
	authFile: string | undefined,
	requireHookEvidence: boolean,
): Promise<AstraTaskResult> {
	const repoPath = await mkdtemp(
		join(tmpdir(), `owx-astra-${variant.name}-${task.id}-`),
	);
	const started = Date.now();
	let allJsonl = "";
	let lastMessage = "";
	let sessionInstructionsPath: string | undefined;
	const retainedEvidence = async (): Promise<
		Pick<AstraTaskResult, "repoPath" | "jsonlPath">
	> => {
		if (!keepWorkdirs) return {};
		const gitDir = join(repoPath, ".git");
		if (!existsSync(gitDir)) return { repoPath };
		const jsonlPath = join(gitDir, "owx-astra-events.jsonl");
		await writeFile(jsonlPath, allJsonl);
		return { repoPath, jsonlPath };
	};
	try {
		const runtimeCodexHome = await writeTaskFixture(repoPath, task, variant);
		if (authFile) {
			if (!existsSync(authFile))
				throw new Error(`Codex auth file is unavailable: ${authFile}`);
			await symlink(authFile, join(runtimeCodexHome, "auth.json"));
		}
		const cliModulePath = join(variant.packageRoot, "dist", "cli", "index.js");
		if (!existsSync(cliModulePath))
			throw new Error(
				`package root is missing dist/cli/index.js: ${variant.packageRoot}`,
			);
		const cliModule = (await import(pathToFileURL(cliModulePath).href)) as {
			injectModelInstructionsBypassArgs: InstructionsInjector;
		};
		sessionInstructionsPath = prepareVariantSessionInstructions(
			variant.packageRoot,
			repoPath,
			runtimeCodexHome,
			`astra-eval-${variant.name}-${task.id}`,
			cliModule.injectModelInstructionsBypassArgs,
		);
		const defaultInstructionsPath =
			sessionInstructionsPath ?? join(repoPath, "AGENTS.md");
		let resumeThreadId: string | undefined;
		for (let index = 0; index < task.prompts.length; index += 1) {
			const lastMessagePath = join(
				repoPath,
				".git",
				`owx-astra-last-message-${index}.txt`,
			);
			const result = executeCodex(
				buildAstraCodexArgs(
					repoPath,
					variant,
					lastMessagePath,
					task.prompts[index],
					cliModule.injectModelInstructionsBypassArgs,
					defaultInstructionsPath,
					resumeThreadId,
				),
				repoPath,
				buildIsolatedCodexEnv(process.env, runtimeCodexHome),
			);
			allJsonl += `${result.stdout ?? ""}\n`;
			if (result.error || result.status !== 0) {
				return {
					taskId: task.id,
					status: "infrastructure_failed",
					grade: null,
					durationMs: Date.now() - started,
					metrics: parseCodexJsonlMetrics(allJsonl),
					infrastructureError: redactAuthSecrets(
						result.error?.message ??
							result.stderr?.trim() ??
							`codex exited ${result.status}`,
					),
					...(await retainedEvidence()),
				};
			}
			if (
				index === 0 &&
				requireHookEvidence &&
				!existsSync(join(repoPath, ".owx", "state", "session.json"))
			) {
				return {
					taskId: task.id,
					status: "infrastructure_failed",
					grade: null,
					durationMs: Date.now() - started,
					metrics: parseCodexJsonlMetrics(allJsonl),
					infrastructureError:
						"OWX SessionStart hook did not create .owx/state/session.json",
					...(await retainedEvidence()),
				};
			}
			if (task.prompts.length > 1 && index === 0) {
				resumeThreadId = threadIdFromJsonl(result.stdout ?? "");
				if (!resumeThreadId) {
					return {
						taskId: task.id,
						status: "infrastructure_failed",
						grade: null,
						durationMs: Date.now() - started,
						metrics: parseCodexJsonlMetrics(allJsonl),
						infrastructureError:
							"continuation run did not emit a thread.started thread_id",
						...(await retainedEvidence()),
					};
				}
			}
			lastMessage = existsSync(lastMessagePath)
				? readFileSync(lastMessagePath, "utf8")
				: "";
		}
		const grade = await grader({
			task,
			repoPath,
			lastMessage,
			jsonl: allJsonl,
		});
		return {
			taskId: task.id,
			status: grade.pass ? "passed" : "task_failed",
			grade,
			durationMs: Date.now() - started,
			metrics: parseCodexJsonlMetrics(allJsonl),
			infrastructureError: null,
			...(await retainedEvidence()),
		};
	} catch (error) {
		return {
			taskId: task.id,
			status: "infrastructure_failed",
			grade: null,
			durationMs: Date.now() - started,
			metrics: allJsonl
				? parseCodexJsonlMetrics(allJsonl)
				: ZERO_UNKNOWN_METRICS,
			infrastructureError: redactAuthSecrets(error),
			...(await retainedEvidence()),
		};
	} finally {
		if (sessionInstructionsPath) {
			await rm(sessionInstructionsPath, { force: true });
		}
		await rm(join(repoPath, ".git", "owx-codex-home", "auth.json"), {
			force: true,
		});
		if (!keepWorkdirs) await rm(repoPath, { recursive: true, force: true });
	}
}

export async function runAstraEvaluation(
	config: {
		baseline: Omit<AstraEvalVariant, "name">;
		candidate: Omit<AstraEvalVariant, "name">;
		grader: AstraGrader;
		tasks?: readonly AstraEvalTask[];
		keepWorkdirs?: boolean;
		codexBinary?: string;
		authFile?: string;
	},
	dependencies: {
		executeCodex?: CodexExecutor;
		requireHookEvidence?: boolean;
	} = {},
): Promise<AstraEvaluationResult> {
	const baseline = {
		...config.baseline,
		packageRoot: await realpath(config.baseline.packageRoot),
	};
	const candidate = {
		...config.candidate,
		packageRoot: await realpath(config.candidate.packageRoot),
	};
	const changedVariable = changedEvaluationVariable(baseline, candidate);
	const executeCodex =
		dependencies.executeCodex ??
		((args, cwd, env) =>
			spawnSync(config.codexBinary ?? "codex", args, {
				cwd,
				env,
				encoding: "utf8",
				input: "",
				maxBuffer: 16 * 1024 * 1024,
				timeout: 20 * 60_000,
			}));
	const authFile =
		config.authFile ??
		(dependencies.executeCodex
			? undefined
			: join(
					process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
					"auth.json",
				));
	const variants: AstraEvalVariant[] = [
		{ name: "baseline", ...baseline },
		{ name: "candidate", ...candidate },
	];
	const results: AstraEvaluationResult["variants"] = [];
	for (const variant of variants) {
		const tasks: AstraTaskResult[] = [];
		for (const task of config.tasks ?? ASTRA_EVAL_TASKS) {
			tasks.push(
				await runTask(
					variant,
					task,
					config.grader,
					executeCodex,
					config.keepWorkdirs ?? false,
					authFile,
					dependencies.requireHookEvidence ?? true,
				),
			);
		}
		results.push({ variant, tasks });
	}
	return { changedVariable, variants: results };
}

export function buildIsolatedCodexEnv(
	source: NodeJS.ProcessEnv,
	runtimeCodexHome: string,
): NodeJS.ProcessEnv {
	const isolated = Object.fromEntries(
		Object.entries(source).filter(
			([key]) => !key.startsWith("OWX_") && !key.startsWith("CODEX_"),
		),
	);
	const pathKey =
		process.platform === "win32"
			? (Object.keys(isolated).find((key) => key.toLowerCase() === "path") ??
				"Path")
			: "PATH";
	const inheritedPath = isolated[pathKey];
	isolated[pathKey] = [join(runtimeCodexHome, "bin"), inheritedPath]
		.filter(Boolean)
		.join(delimiter);
	return {
		...isolated,
		CODEX_HOME: runtimeCodexHome,
		CODEX_SQLITE_HOME: runtimeCodexHome,
	};
}

function readArg(args: string[], name: string): string {
	const index = args.indexOf(name);
	const value = index >= 0 ? args[index + 1] : undefined;
	if (!value || value.startsWith("--"))
		throw new Error(`missing required ${name}`);
	return value;
}

async function main(args = process.argv.slice(2)): Promise<void> {
	const graderModule = args.includes("--grader")
		? ((await import(
				pathToFileURL(resolve(readArg(args, "--grader"))).href
			)) as { grade?: AstraGrader })
		: ((await import("./grader.js")) as { grade?: AstraGrader });
	if (typeof graderModule.grade !== "function")
		throw new Error("grader module must export grade(context)");
	const baseline = {
		packageRoot: resolve(readArg(args, "--baseline-package-root")),
		model: readArg(args, "--baseline-model"),
		effort: parseConfiguredAgentReasoningEffort(
			readArg(args, "--baseline-effort"),
			"--baseline-effort",
		),
	};
	const candidate = {
		packageRoot: resolve(readArg(args, "--candidate-package-root")),
		model: readArg(args, "--candidate-model"),
		effort: parseConfiguredAgentReasoningEffort(
			readArg(args, "--candidate-effort"),
			"--candidate-effort",
		),
	};
	const result = await runAstraEvaluation({
		baseline,
		candidate,
		grader: graderModule.grade,
		keepWorkdirs: args.includes("--keep-workdirs"),
		codexBinary: args.includes("--codex-bin")
			? readArg(args, "--codex-bin")
			: undefined,
		authFile: args.includes("--auth-file")
			? resolve(readArg(args, "--auth-file"))
			: undefined,
	});
	const output = JSON.stringify(result, null, 2);
	const outputPath = args.includes("--output")
		? resolve(readArg(args, "--output"))
		: undefined;
	if (outputPath) await writeFile(outputPath, `${output}\n`);
	else process.stdout.write(`${output}\n`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (
	entry &&
	isAbsolute(entry) &&
	import.meta.url === pathToFileURL(entry).href
) {
	main().catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
