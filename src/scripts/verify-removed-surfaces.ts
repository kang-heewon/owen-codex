#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export interface InspectionFile {
	path: string;
	content: string;
}

export interface ForbiddenPathRule {
	id: string;
	path: string;
	kind: "exact" | "prefix" | "segment";
}

export interface ForbiddenContentRule {
	id: string;
	source: string;
	flags?: string;
}

export interface RemovedSurfaceAllowlist {
	inertnessFixture: string | readonly string[];
	migrationTombstone: string | readonly string[];
	changelog: string | readonly string[];
}

export interface RemovedSurfaceContract {
	forbiddenPaths: readonly ForbiddenPathRule[];
	forbiddenContent: readonly ForbiddenContentRule[];
	allowContentOnlyIn: RemovedSurfaceAllowlist;
}

export interface SurfaceDiagnostic {
	path: string;
	line: number;
	column: number;
	ruleId: string;
	match: string;
	message: string;
}

const token = (...parts: string[]): string => parts.join("");

export const DEFAULT_REMOVED_SURFACE_ALLOWLIST: RemovedSurfaceAllowlist = {
	inertnessFixture: token(
		"src/cli/__tests__/fixtures/removed-",
		"surfaces-inertness.json",
	),
	migrationTombstone: token("src/setup/migrations/removed-", "surfaces-v1.ts"),
	changelog: "CHANGELOG.md",
};

export function createRemovedSurfaceContract(): RemovedSurfaceContract {
	const team = token("te", "am");
	const terminalMux = token("tm", "ux");
	const runtime = token("run", "time");
	const auxiliaryUi = token("side", "car");
	const question = token("ques", "tion");
	const reply = token("reply", "-listener");
	const sessionRegistry = token("session", "-registry");
	const sessionStatus = token("session", "-status");
	const fallbackApiIdentifier = token("notify", "Fallback");
	const fallbackDashedIdentifier = token("notify", "-fallback");

	return {
		allowContentOnlyIn: DEFAULT_REMOVED_SURFACE_ALLOWLIST,
		forbiddenPaths: [
			{
				id: token("notify-", "fallback-watcher-path"),
				path: token("src/scripts/notify-", "fallback-watcher.ts"),
				kind: "exact",
			},
			{ id: "team-tree", path: `src/${team}`, kind: "prefix" },
			{ id: "team-cli", path: `src/cli/${team}.ts`, kind: "exact" },
			{
				id: "team-pipeline-stage",
				path: `src/pipeline/stages/${team}-exec.ts`,
				kind: "exact",
			},
			{
				id: token("tm", "ux-cli-hook"),
				path: `src/cli/${terminalMux}-hook.ts`,
				kind: "exact",
			},
			{
				id: token("tm", "ux-hook-engine"),
				path: `src/scripts/${terminalMux}-hook-engine.ts`,
				kind: "exact",
			},
			{
				id: token("tm", "ux-hook-sdk"),
				path: `src/hooks/extensibility/sdk/${terminalMux}.ts`,
				kind: "exact",
			},
			{ id: "runtime-bridge", path: `src/${runtime}/bridge.ts`, kind: "exact" },
			{ id: "hud-authority", path: "src/hud/authority.ts", kind: "exact" },
			{
				id: token("side", "car-tree"),
				path: `src/${auxiliaryUi}`,
				kind: "prefix",
			},
			{ id: "question-tree", path: `src/${question}`, kind: "prefix" },
			{
				id: "runtime-mux-crate",
				path: token("crates/owx-", "mux"),
				kind: "prefix",
			},
			{
				id: "runtime-core-crate",
				path: `crates/owx-${runtime}-core`,
				kind: "prefix",
			},
			{
				id: "runtime-crate",
				path: `crates/owx-${runtime}`,
				kind: "prefix",
			},
			{
				id: token("inbound-reply", "-listener"),
				path: `src/notifications/${reply}.ts`,
				kind: "exact",
			},
			{
				id: token("inbound-session", "-registry"),
				path: `src/notifications/${sessionRegistry}.ts`,
				kind: "exact",
			},
			{
				id: token("inbound-session", "-status"),
				path: `src/notifications/${sessionStatus}.ts`,
				kind: "exact",
			},
		],
		forbiddenContent: [
			{ id: token("notify-", "fallback-api"), source: `\\b${fallbackApiIdentifier}\\b` },
			{ id: token("notify-", "fallback-state"), source: `${fallbackDashedIdentifier}(?:-state(?:\\.json)?)?`, flags: "i" },
			{ id: token("notify-", "fallback-env"), source: token("OWX_NOTIFY_", "FALLBACK") },
			{ id: "notification-reply-config", source: token("notifications\\.", "reply"), flags: "i" },
			{ id: "notification-reply-env", source: token("OWX_REPLY_", "ENABLED") },
			{ id: token("reply-", "listener-phrase"), source: token("reply\\s+", "listener"), flags: "i" },
			{ id: token("tm", "ux"), source: `\\b${terminalMux}\\b`, flags: "i" },
			{
				id: token("tm", "ux-compatible"),
				source: token("\\b(?:ps|c)m", "ux\\b"),
				flags: "i",
			},
			{
				id: "team-command",
				source: `(?:\\$${team}\\b|\\bowx\\s+${team}\\b)`,
				flags: "i",
			},
			{
				id: "worker-skill",
				source: token("\\$(?:wor", "ker|swarm)\\b"),
				flags: "i",
			},
			{
				id: token("team", "-state"),
				source: `${team}(?:-|_)state(?:\\.json)?`,
				flags: "i",
			},
			{
				id: token("team", "-state-root"),
				source: token("OWX_", "TEAM_", "STATE_ROOT"),
			},
			{
				id: "team-source-reference",
				source: `(?:src|dist)/${team}(?:/|\\b)`,
				flags: "i",
			},
			{
				id: token("team", "-executor"),
				source: `${team}-executor`,
				flags: "i",
			},
			{ id: "runtime-mux", source: token("owx-", "mux"), flags: "i" },
			{ id: "runtime-core", source: `owx-${runtime}-core`, flags: "i" },
			{ id: "runtime-crate", source: `owx-${runtime}(?!-core)`, flags: "i" },
			{ id: "runtime-bridge-env", source: token("OWX_RUNTIME_", "BRIDGE") },
			{ id: "runtime-binary-env", source: token("OWX_RUNTIME_", "BINARY") },
			{
				id: "runtime-bridge-source",
				source: `src/${runtime}/bridge`,
				flags: "i",
			},
			{ id: token("reply", "-listener"), source: reply, flags: "i" },
			{
				id: token("session", "-registry"),
				source: sessionRegistry,
				flags: "i",
			},
			{ id: token("session", "-status"), source: sessionStatus, flags: "i" },
			{
				id: "live-reply-script",
				source: token("test:", "reply-", "listener:live"),
				flags: "i",
			},
			{
				id: token("side", "car"),
				source: `\\b${auxiliaryUi}\\b`,
				flags: "i",
			},
			{
				id: "question-command",
				source: `\\bowx\\s+${question}\\b`,
				flags: "i",
			},
			{ id: "question-source", source: `src/${question}(?:/|\\b)`, flags: "i" },
		],
	};
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isPathMatch(path: string, rule: ForbiddenPathRule): boolean {
	const expected = normalizePath(rule.path).replace(/\/$/, "");
	if (rule.kind === "exact") return path === expected;
	if (rule.kind === "prefix")
		return path === expected || path.startsWith(`${expected}/`);
	return path.split("/").includes(expected);
}

function lineAndColumn(
	content: string,
	offset: number,
): { line: number; column: number } {
	const before = content.slice(0, offset);
	const lines = before.split("\n");
	return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function allowedContentPaths(allowlist: RemovedSurfaceAllowlist): Set<string> {
	return new Set(
		[
			allowlist.inertnessFixture,
			allowlist.migrationTombstone,
			allowlist.changelog,
		]
			.flatMap((entry) => (typeof entry === "string" ? [entry] : entry))
			.map(normalizePath),
	);
}

export function inspectRemovedSurfaces(
	files: readonly InspectionFile[],
	contract: RemovedSurfaceContract = createRemovedSurfaceContract(),
): SurfaceDiagnostic[] {
	const allowed = allowedContentPaths(contract.allowContentOnlyIn);
	const diagnostics: SurfaceDiagnostic[] = [];

	for (const file of [...files].sort((a, b) =>
		normalizePath(a.path).localeCompare(normalizePath(b.path)),
	)) {
		const path = normalizePath(file.path);
		for (const rule of contract.forbiddenPaths) {
			if (!isPathMatch(path, rule)) continue;
			diagnostics.push({
				path,
				line: 1,
				column: 1,
				ruleId: rule.id,
				match: path,
				message: "removed path is still present",
			});
		}

		if (allowed.has(path)) continue;
		for (const rule of contract.forbiddenContent) {
			const flags = [...new Set(`${rule.flags ?? ""}g`)].join("");
			const pattern = new RegExp(rule.source, flags);
			for (const match of file.content.matchAll(pattern)) {
				if (match.index === undefined) continue;
				const location = lineAndColumn(file.content, match.index);
				diagnostics.push({
					path,
					...location,
					ruleId: rule.id,
					match: match[0],
					message: "removed surface identifier is still present",
				});
				if (match[0].length === 0) break;
			}
		}
	}

	return diagnostics.sort(
		(a, b) =>
			a.path.localeCompare(b.path) ||
			a.line - b.line ||
			a.column - b.column ||
			a.ruleId.localeCompare(b.ruleId),
	);
}

export function formatSurfaceDiagnostic(diagnostic: SurfaceDiagnostic): string {
	return `${diagnostic.path}:${diagnostic.line}:${diagnostic.column} [${diagnostic.ruleId}] ${diagnostic.message}: ${JSON.stringify(diagnostic.match)}`;
}

const IGNORED_DIRECTORY_NAMES = new Set([
	".git",
	".owx",
	"coverage",
	"dist",
	"node_modules",
	"target",
]);

async function collectRepositoryFiles(
	root: string,
	directory = root,
): Promise<InspectionFile[]> {
	const files: InspectionFile[] = [];
	const entries = await readdir(directory, { withFileTypes: true });
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name))
			continue;
		const absolutePath = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectRepositoryFiles(root, absolutePath)));
			continue;
		}
		if (!entry.isFile()) continue;
		const content = await readFile(absolutePath);
		if (content.includes(0)) continue;
		files.push({
			path: relative(root, absolutePath).split(sep).join("/"),
			content: content.toString("utf8"),
		});
	}
	return files;
}

async function main(): Promise<void> {
	const root = resolve(process.cwd());
	const diagnostics = inspectRemovedSurfaces(
		await collectRepositoryFiles(root),
	);
	if (diagnostics.length > 0) {
		for (const diagnostic of diagnostics)
			console.error(formatSurfaceDiagnostic(diagnostic));
		throw new Error(
			`removed surface verification failed with ${diagnostics.length} diagnostic(s)`,
		);
	}
	console.log("removed surface verification: PASS");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
