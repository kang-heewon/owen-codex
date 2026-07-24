import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const REMOVED_SURFACES_MIGRATION_VERSION = 1 as const;
export const REMOVED_SURFACES_V1_MCP_SERVER = "owx_team_run";

export interface RemovedSurfaceAsset {
	kind: "prompt" | "skill" | "native-agent";
	relativePath: string;
	sha256: readonly string[];
}

/**
 * Frozen hashes of setup-owned files shipped before the Team runtime was
 * retired. Additions require a new migration version; setup must never learn
 * ownership from the currently-installed package because that would turn a
 * same-name user file into a deletion candidate.
 */
export const REMOVED_SURFACES_V1_ASSETS: readonly RemovedSurfaceAsset[] =
	Object.freeze([
		Object.freeze({
			kind: "prompt" as const,
			relativePath: "team-executor.md",
			sha256: Object.freeze([
				"0e13c0e5a755881756476bc48ba5f38c6e02506d8db4d96cf543c96343336b62",
				"3468fc7be9ca9fb67367df12a21532350958c07624d3269eec643f8f1e1a21cb",
				"364bc1efa99f7e0c8b32ee40b51243137cea9e2b0b931790f4284a993ae0c6f8",
				"cadb6bc60a4d1cf80e75eef6c2c9f95cf6a1312a7edb8f3c01bf991d404c9509",
			]),
		}),
		Object.freeze({
			kind: "prompt" as const,
			relativePath: "team-orchestrator.md",
			sha256: Object.freeze([
				"86dd2852fd5364cec32882409d1837bab239468754e360a84fd8325eb93c7d2a",
			]),
		}),
		Object.freeze({
			kind: "skill" as const,
			relativePath: "team/SKILL.md",
			sha256: Object.freeze([
				"2163d2df462e21a9c5734dfbd764044195814937866cfe037b5a860a2f803397",
				"be08ddbb8301cbef6a3ae62d32292d996dac23b4ad52c618376055f9a1557ffc",
				"cd506f022ae3c4402815234cc7bca947d9abbd785f98c41916f4c8d76a7e80c8",
				"e059b65ed89461878e36d6a9032acc2c9a6f276f1cca6b36735022f84a43f60e",
			]),
		}),
		Object.freeze({
			kind: "skill" as const,
			relativePath: "worker/SKILL.md",
			sha256: Object.freeze([
				"40024799211d73efb289411041497cfda4582294bab1674cbcca067140d2d6af",
				"d0d46a07b7675ac854d993be56565bc96d0f3c8c0776ec38a58955df3003fe51",
				"f92437d1d0ee63c936eb677ac2237b4e99189917d87dbf20345d5ef9cefe462c",
				"a929ac0deb2ce290f702ef56505780a608a72de71b4f8dc3d778e66cfd6f43e4",
			]),
		}),
		Object.freeze({
			kind: "skill" as const,
			relativePath: "swarm/SKILL.md",
			sha256: Object.freeze([
				"26290431a48e6863f15776b97656c135876831434792001888c245552b63c069",
				"9806ce3dff32a149edc61bc62ee20ecadc1cce6fdc9f997f3abc5ec4cc1633d4",
				"6d08bed6e4a06c786fc480ab828af773af8924f7a0714356d14671638900928a",
				"6c15cc12c49bd5ce293781bf179b8c0af99753e831f54afb08f57f1c7a0a00e0",
			]),
		}),
		Object.freeze({
			kind: "native-agent" as const,
			relativePath: "team-executor.toml",
			sha256: Object.freeze([
				"1e184d9726b6d1dd2ce578188d3df7f6bf1a2e30b818b9db3caec84e6ced7ebe",
			]),
		}),
	]);

export interface RemovedSurfacesMigrationDependencies {
	exists(path: string): boolean;
	read(path: string): Promise<Buffer>;
	lstat(path: string): ReturnType<typeof lstat>;
	readdir(path: string): Promise<string[]>;
	remove(
		path: string,
		options: { recursive?: boolean; force?: boolean },
	): Promise<void>;
	write(path: string, content: string): Promise<void>;
	processCommand(pid: number): string | null;
	kill(pid: number, signal: NodeJS.Signals): void;
}

export interface RemovedSurfacesMigrationOptions {
	promptsDir: string;
	skillsDir: string;
	nativeAgentsDir: string;
	legacyReplyStateDir?: string;
	codexConfigPath?: string;
	notificationConfigPath?: string;
	dryRun?: boolean;
	backup?: (path: string) => Promise<void>;
	dependencies?: Partial<RemovedSurfacesMigrationDependencies>;
}

export interface RemovedSurfacesMigrationResult {
	version: typeof REMOVED_SURFACES_MIGRATION_VERSION;
	removed: string[];
	preserved: string[];
	warnings: string[];
	backupRequested: string[];
	decisions: Array<{
		path: string;
		action: "remove" | "preserve";
		provenance: string;
	}>;
	signaledReplyListenerPid: number | null;
	wouldSignalReplyListenerPid: number | null;
}

function defaultProcessCommand(pid: number): string | null {
	try {
		if (process.platform === "linux") {
			return readFileSync(`/proc/${pid}/cmdline`, "utf-8").replaceAll(
				"\0",
				" ",
			);
		}
		if (process.platform === "win32") return null;
		const result = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
			encoding: "utf-8",
			timeout: 3_000,
		});
		return result.status === 0 && !result.error ? result.stdout.trim() : null;
	} catch {
		return null;
	}
}

const DEFAULT_DEPENDENCIES: RemovedSurfacesMigrationDependencies = {
	exists: existsSync,
	read: readFile,
	lstat,
	readdir: async (path) => readdir(path),
	remove: rm,
	write: writeFile,
	processCommand: defaultProcessCommand,
	kill: (pid, signal) => process.kill(pid, signal),
};

function hash(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

const RETIRED_MCP_TABLE_PATTERN = new RegExp(
	`^\\s*\\[mcp_servers\\.(?:"${REMOVED_SURFACES_V1_MCP_SERVER}"|${REMOVED_SURFACES_V1_MCP_SERVER})\\]\\s*$`,
);

export function hasRetiredManagedMcpTable(config: string): boolean {
	return config.split(/\r?\n/).some((line) => RETIRED_MCP_TABLE_PATTERN.test(line));
}

export function stripRetiredManagedMcpTable(config: string): string {
	const lines = config.split(/\r?\n/);
	const kept: string[] = [];
	for (let index = 0; index < lines.length; ) {
		if (!RETIRED_MCP_TABLE_PATTERN.test(lines[index] ?? "")) {
			kept.push(lines[index] ?? "");
			index += 1;
			continue;
		}
		index += 1;
		while (index < lines.length && !/^\s*\[/.test(lines[index] ?? "")) index += 1;
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function migrateConfigFiles(
	options: RemovedSurfacesMigrationOptions,
	deps: RemovedSurfacesMigrationDependencies,
	result: RemovedSurfacesMigrationResult,
): Promise<void> {
	if (options.codexConfigPath && deps.exists(options.codexConfigPath)) {
		const content = (await deps.read(options.codexConfigPath)).toString("utf-8");
		const cleaned = stripRetiredManagedMcpTable(content);
		if (cleaned !== content) {
			await requestBackup(options.codexConfigPath, options, result);
			if (!options.dryRun) await deps.write(options.codexConfigPath, cleaned);
			result.removed.push(options.codexConfigPath);
			recordDecision(result, options.codexConfigPath, "remove", "retired-mcp-table");
		}
	}

	if (options.notificationConfigPath && deps.exists(options.notificationConfigPath)) {
		const raw = (await deps.read(options.notificationConfigPath)).toString("utf-8");
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const notifications = parsed.notifications;
			if (notifications && typeof notifications === "object" && !Array.isArray(notifications) && Object.hasOwn(notifications, "reply")) {
				const cleanedNotifications = { ...(notifications as Record<string, unknown>) };
				delete cleanedNotifications.reply;
				const cleaned = JSON.stringify({ ...parsed, notifications: cleanedNotifications }, null, 2) + "\n";
				await requestBackup(options.notificationConfigPath, options, result);
				if (!options.dryRun) await deps.write(options.notificationConfigPath, cleaned);
				result.removed.push(options.notificationConfigPath);
				recordDecision(result, options.notificationConfigPath, "remove", "retired-notification-reply-config");
			}
		} catch (error) {
			result.preserved.push(options.notificationConfigPath);
			recordDecision(result, options.notificationConfigPath, "preserve", "invalid-notification-config");
			result.warnings.push(`preserved notification config ${options.notificationConfigPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

async function requestBackup(
	path: string,
	options: RemovedSurfacesMigrationOptions,
	result: RemovedSurfacesMigrationResult,
): Promise<void> {
	if (!options.backup) return;
	await options.backup(path);
	result.backupRequested.push(path);
}

function recordDecision(
	result: RemovedSurfacesMigrationResult,
	path: string,
	action: "remove" | "preserve",
	provenance: string,
): void {
	result.decisions.push({ path, action, provenance });
}

function rootForAsset(
	asset: RemovedSurfaceAsset,
	options: RemovedSurfacesMigrationOptions,
): string {
	if (asset.kind === "prompt") return options.promptsDir;
	if (asset.kind === "skill") return options.skillsDir;
	return options.nativeAgentsDir;
}

function isLegacyReplyListenerCommand(command: string): boolean {
	return (
		/(?:^|[\\/])reply-listener(?:\.js)?(?:[\s'"?]|$)/.test(command) &&
		/\bpollLoop\b/.test(command) &&
		/(?:^|\s)(?:[^\s]+[\\/])?node(?:\.exe)?(?:\s|$)/i.test(command)
	);
}

async function migrateAsset(
	asset: RemovedSurfaceAsset,
	options: RemovedSurfacesMigrationOptions,
	deps: RemovedSurfacesMigrationDependencies,
	result: RemovedSurfacesMigrationResult,
): Promise<void> {
	const path = join(rootForAsset(asset, options), asset.relativePath);
	if (!deps.exists(path)) return;

	try {
		const info = await deps.lstat(path);
		if (!info.isFile() || info.isSymbolicLink()) {
			result.preserved.push(path);
			recordDecision(result, path, "preserve", "ambiguous-file-type");
			result.warnings.push(
				`preserved ambiguous retired surface ${path}: expected a regular setup-owned file`,
			);
			return;
		}
		if (!asset.sha256.includes(hash(await deps.read(path)))) {
			result.preserved.push(path);
			recordDecision(result, path, "preserve", "unrecognized-sha256");
			result.warnings.push(
				`preserved modified or unrecognized retired surface ${path}`,
			);
			return;
		}

		if (asset.kind === "skill") {
			const skillDir = join(
				options.skillsDir,
				asset.relativePath.split("/")[0],
			);
			const entries = await deps.readdir(skillDir);
			if (entries.length !== 1 || entries[0] !== "SKILL.md") {
				result.preserved.push(skillDir);
				recordDecision(
					result,
					skillDir,
					"preserve",
					"unrecognized-skill-contents",
				);
				result.warnings.push(
					`preserved retired skill ${skillDir}: directory contains user or unrecognized files`,
				);
				return;
			}
			await requestBackup(path, options, result);
			if (!options.dryRun)
				await deps.remove(skillDir, { recursive: true, force: true });
			result.removed.push(skillDir);
			recordDecision(result, skillDir, "remove", "frozen-sha256");
			return;
		}

		await requestBackup(path, options, result);
		if (!options.dryRun) await deps.remove(path, { force: true });
		result.removed.push(path);
		recordDecision(result, path, "remove", "frozen-sha256");
	} catch (error) {
		result.preserved.push(path);
		recordDecision(result, path, "preserve", "inspection-error");
		result.warnings.push(
			`preserved retired surface ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function isRecognizedReplyConfig(content: Buffer): boolean {
	try {
		const parsed = JSON.parse(content.toString("utf-8")) as Record<
			string,
			unknown
		>;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return false;
		return (
			typeof parsed.enabled === "boolean" &&
			typeof parsed.pollIntervalMs === "number" &&
			typeof parsed.maxMessageLength === "number" &&
			typeof parsed.rateLimitPerMinute === "number" &&
			typeof parsed.includePrefix === "boolean" &&
			Array.isArray(parsed.authorizedDiscordUserIds) &&
			typeof parsed.discordEnabled === "boolean" &&
			typeof parsed.telegramEnabled === "boolean"
		);
	} catch {
		return false;
	}
}

async function migrateReplyArtifacts(
	stateDir: string,
	options: RemovedSurfacesMigrationOptions,
	deps: RemovedSurfacesMigrationDependencies,
	result: RemovedSurfacesMigrationResult,
): Promise<void> {
	const pidPath = join(stateDir, "reply-listener.pid");
	const configPath = join(stateDir, "reply-listener-config.json");
	if (!deps.exists(pidPath) && !deps.exists(configPath)) return;

	let provenListenerPid: number | null = null;
	if (deps.exists(pidPath)) {
		try {
			const pidInfo = await deps.lstat(pidPath);
			if (!pidInfo.isFile() || pidInfo.isSymbolicLink()) {
				throw new Error("expected a regular PID file");
			}
			const rawPid = (await deps.read(pidPath)).toString("utf-8").trim();
			if (!/^[1-9]\d*$/.test(rawPid)) throw new Error("invalid PID file");
			const pid = Number(rawPid);
			if (!Number.isSafeInteger(pid)) throw new Error("invalid PID file");
			let command: string | null = null;
			try {
				command = deps.processCommand(pid);
			} catch {
				// Any inspection failure is an identity miss.
			}
			if (!command || !isLegacyReplyListenerCommand(command)) {
				throw new Error(
					`PID ${pid} does not prove the legacy listener identity`,
				);
			}
			await requestBackup(pidPath, options, result);
			if (options.dryRun) {
				result.wouldSignalReplyListenerPid = pid;
			} else {
				deps.kill(pid, "SIGTERM");
				result.signaledReplyListenerPid = pid;
				await deps.remove(pidPath, { force: true });
			}
			provenListenerPid = pid;
			result.removed.push(pidPath);
			recordDecision(result, pidPath, "remove", "proven-process-identity");
		} catch (error) {
			result.preserved.push(pidPath);
			recordDecision(result, pidPath, "preserve", "unproven-process-identity");
			result.warnings.push(
				`preserved retired reply-listener PID ${pidPath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	if (deps.exists(configPath)) {
		try {
			const configInfo = await deps.lstat(configPath);
			if (!configInfo.isFile() || configInfo.isSymbolicLink()) {
				throw new Error("expected a regular config file");
			}
			const content = await deps.read(configPath);
			if (provenListenerPid === null && !isRecognizedReplyConfig(content)) {
				throw new Error("unrecognized reply-listener config schema");
			}
			await requestBackup(configPath, options, result);
			if (!options.dryRun) await deps.remove(configPath, { force: true });
			result.removed.push(configPath);
			recordDecision(
				result,
				configPath,
				"remove",
				provenListenerPid === null
					? "recognized-reply-config-schema"
					: "proven-process-identity",
			);
		} catch (error) {
			result.preserved.push(configPath);
			recordDecision(
				result,
				configPath,
				"preserve",
				"unrecognized-reply-config",
			);
			result.warnings.push(
				`preserved retired reply-listener config ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

export async function migrateRemovedSurfacesV1(
	options: RemovedSurfacesMigrationOptions,
): Promise<RemovedSurfacesMigrationResult> {
	const deps = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
	const result: RemovedSurfacesMigrationResult = {
		version: REMOVED_SURFACES_MIGRATION_VERSION,
		removed: [],
		preserved: [],
		warnings: [],
		backupRequested: [],
		decisions: [],
		signaledReplyListenerPid: null,
		wouldSignalReplyListenerPid: null,
	};

	for (const asset of REMOVED_SURFACES_V1_ASSETS) {
		await migrateAsset(asset, options, deps, result);
	}
	await migrateConfigFiles(options, deps, result);
	await migrateReplyArtifacts(
		options.legacyReplyStateDir ?? join(homedir(), ".owx", "state"),
		options,
		deps,
		result,
	);
	return result;
}
