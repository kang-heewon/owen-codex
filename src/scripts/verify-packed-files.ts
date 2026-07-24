#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
	createRemovedSurfaceContract,
	type InspectionFile,
	inspectRemovedSurfaces,
	type RemovedSurfaceContract,
	type SurfaceDiagnostic,
} from "./verify-removed-surfaces.js";

export interface NpmPackFileEntry {
	path: string;
	size?: number;
	mode?: number;
}

interface NpmPackResult {
	files?: NpmPackFileEntry[];
}

export interface PackedFile extends NpmPackFileEntry {
	content?: string;
}

export interface PackedFilesContract {
	removedSurfaces: RemovedSurfaceContract;
	forbiddenPathSegments: readonly string[];
	forbiddenExactPaths: readonly string[];
}

const token = (...parts: string[]): string => parts.join("");

export function parseNpmPackDryRunJson(output: string): NpmPackFileEntry[] {
	const starts = [...output.matchAll(/(?:^|\n)\s*\[/g)].map(
		(match) => (match.index ?? 0) + match[0].lastIndexOf("["),
	);
	for (const start of starts.reverse()) {
		try {
			const parsed = JSON.parse(output.slice(start).trim()) as NpmPackResult[];
			if (!Array.isArray(parsed)) continue;
			const files = parsed.flatMap((result) =>
				Array.isArray(result.files) ? result.files : [],
			);
			if (files.every((file) => typeof file.path === "string")) return files;
		} catch {
			// Prepack output can precede the final JSON array; try the previous array start.
		}
	}
	throw new Error(
		"npm pack --dry-run did not produce a valid JSON file inventory",
	);
}

export function createPackedFilesContract(): PackedFilesContract {
	const removed = createRemovedSurfaceContract();
	const sourceTombstone = removed.allowContentOnlyIn.migrationTombstone;
	if (typeof sourceTombstone !== "string") {
		throw new Error(
			"source removal contract must name one migration tombstone",
		);
	}
	const compiledTombstone = sourceTombstone
		.replace(/^src\//, "dist/")
		.replace(/\.ts$/, "");
	removed.allowContentOnlyIn = {
		inertnessFixture: token(
			"__never_packed__/removed-",
			"surfaces-inertness.json",
		),
		migrationTombstone: [
			`${compiledTombstone}.js`,
			`${compiledTombstone}.js.map`,
			`${compiledTombstone}.d.ts`,
			`${compiledTombstone}.d.ts.map`,
		],
		changelog: removed.allowContentOnlyIn.changelog,
	};
	removed.forbiddenPaths = removed.forbiddenPaths.flatMap((rule) => {
		if (!rule.path.startsWith("src/")) return [rule];
		const compiledPath = rule.path
			.replace(/^src\//, "dist/")
			.replace(/\.ts$/, ".js");
		return [
			rule,
			{
				...rule,
				id: `packed-${rule.id}`,
				path: compiledPath,
			},
		];
	});

	return {
		removedSurfaces: removed,
		forbiddenPathSegments: ["__tests__", "fixtures"],
		forbiddenExactPaths: [DEFAULT_PACKED_INERTNESS_FIXTURE],
	};
}

export const DEFAULT_PACKED_INERTNESS_FIXTURE = token(
	"src/cli/__tests__/fixtures/removed-",
	"surfaces-inertness.json",
);

function normalizePackedPath(path: string): string {
	return path
		.replaceAll("\\", "/")
		.replace(/^\.\//, "")
		.replace(/^package\//, "");
}

export function inspectPackedFiles(
	files: readonly PackedFile[],
	contract: PackedFilesContract = createPackedFilesContract(),
): SurfaceDiagnostic[] {
	const diagnostics: SurfaceDiagnostic[] = [];
	const inspectionFiles: InspectionFile[] = [];
	const forbiddenExactPaths = new Set(
		contract.forbiddenExactPaths.map(normalizePackedPath),
	);

	for (const file of files) {
		const path = normalizePackedPath(file.path);
		const segments = path.split("/");
		if (
			forbiddenExactPaths.has(path) ||
			contract.forbiddenPathSegments.some((segment) =>
				segments.includes(segment),
			)
		) {
			diagnostics.push({
				path,
				line: 1,
				column: 1,
				ruleId: "packed-test-or-fixture",
				match: path,
				message: "test or fixture must not be shipped",
			});
		}
		inspectionFiles.push({ path, content: file.content ?? "" });
	}

	return [
		...diagnostics,
		...inspectRemovedSurfaces(inspectionFiles, contract.removedSurfaces),
	].sort(
		(a, b) =>
			a.path.localeCompare(b.path) ||
			a.line - b.line ||
			a.column - b.column ||
			a.ruleId.localeCompare(b.ruleId),
	);
}

async function main(): Promise<void> {
	const root = resolve(process.cwd());
	const result = spawnSync(
		"npm",
		["pack", "--json", "--dry-run", "--ignore-scripts"],
		{
			cwd: root,
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		throw new Error(
			result.stderr || `npm pack --dry-run exited with ${result.status}`,
		);
	}
	const inventory = parseNpmPackDryRunJson(result.stdout);
	const files: PackedFile[] = await Promise.all(
		inventory.map(async (entry) => {
			const path = resolve(root, normalizePackedPath(entry.path));
			try {
				const content = await readFile(path, "utf8");
				return { ...entry, content };
			} catch (error) {
				throw new Error(
					`packed file verification could not read ${normalizePackedPath(entry.path)}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
	);
	const diagnostics = inspectPackedFiles(files);
	if (diagnostics.length > 0) {
		for (const diagnostic of diagnostics) {
			console.error(
				`${diagnostic.path}:${diagnostic.line}:${diagnostic.column} [${diagnostic.ruleId}] ${diagnostic.message}: ${JSON.stringify(diagnostic.match)}`,
			);
		}
		throw new Error(
			`packed file verification failed with ${diagnostics.length} diagnostic(s)`,
		);
	}
	console.log("packed file verification: PASS");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
