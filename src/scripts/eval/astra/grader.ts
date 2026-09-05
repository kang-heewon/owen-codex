import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AstraGrade, AstraGraderContext } from "./index.js";

interface CommandResult {
	pass: boolean;
	stdout: string;
	details: string;
}

function run(repoPath: string, command: string, args: string[]): CommandResult {
	const result = spawnSync(command, args, {
		cwd: repoPath,
		encoding: "utf8",
		timeout: 30_000,
	});
	const stdout = result.stdout.trimEnd();
	const stderr = result.stderr.trim();
	return {
		pass: result.status === 0,
		stdout,
		details: stderr || stdout || `exit ${result.status}`,
	};
}

function filesBelow(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(root, {
		withFileTypes: true,
		recursive: true,
	})) {
		if (entry.isFile())
			files.push(relative(root, join(entry.parentPath, entry.name)));
	}
	return files.sort();
}

function gradeExplanation(context: AstraGraderContext): AstraGrade {
	const status = run(context.repoPath, "git", [
		"status",
		"--porcelain",
		"--untracked-files=all",
	]);
	const productChanges = status.stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.filter((line) => !line.slice(3).startsWith(".owx/"));
	const stateRoot = join(context.repoPath, ".owx", "state");
	const activatedWorkflowFiles = filesBelow(stateRoot).filter((path) => {
		if (!path.endsWith(".json")) return false;
		try {
			const value = JSON.parse(readFileSync(join(stateRoot, path), "utf8")) as {
				active?: unknown;
				mode?: unknown;
			};
			return (
				value.active === true ||
				(typeof value.active === "boolean" && typeof value.mode === "string")
			);
		} catch {
			return false;
		}
	});
	const pass =
		status.pass &&
		productChanges.length === 0 &&
		activatedWorkflowFiles.length === 0 &&
		context.lastMessage.trim() !== "";
	return {
		pass,
		score: pass ? 1 : 0,
		details: { productChanges, activatedWorkflowFiles },
	};
}

function gradeBugRepair(context: AstraGraderContext): AstraGrade {
	const result = run(context.repoPath, "node", [
		"--input-type=module",
		"-e",
		"import assert from 'node:assert/strict'; import { sum } from './sum.mjs'; assert.equal(sum([]), 0); assert.equal(sum([2, 3, 4]), 9); assert.equal(sum([-2, 5]), 3);",
	]);
	return {
		pass: result.pass,
		score: result.pass ? 1 : 0,
		details: result.details,
	};
}

function gradeMultiFile(context: AstraGraderContext): AstraGrade {
	const changed = run(context.repoPath, "git", [
		"status",
		"--porcelain",
		"--untracked-files=all",
	])
		.stdout.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => line.slice(3));
	const result = run(context.repoPath, "node", [
		"--input-type=module",
		"-e",
		"import assert from 'node:assert/strict'; import { saveUser, findUser } from './src/user.mjs'; assert.equal(findUser('missing'), undefined); saveUser({id:'u2',name:'Grace'}); assert.deepEqual(findUser('u2'), {id:'u2',name:'Grace'});",
	]);
	const requiredFilesChanged = ["src/find-user.mjs", "src/user.mjs"].every(
		(path) => changed.includes(path),
	);
	const pass = result.pass && requiredFilesChanged;
	return {
		pass,
		score: pass ? 1 : 0,
		details: { assertion: result.details, changed, requiredFilesChanged },
	};
}

function gradeStrictWorkflow(context: AstraGraderContext): AstraGrade {
	const status = run(context.repoPath, "git", [
		"status",
		"--porcelain",
		"--untracked-files=all",
	]);
	const productChanges = status.stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.filter((line) => !line.slice(3).startsWith(".owx/"));
	const plansRoot = join(context.repoPath, ".owx", "plans");
	const plans = filesBelow(plansRoot).filter((path) => path.endsWith(".md"));
	const prdPath = plans.find((path) => /prd|plan/i.test(path));
	const testSpecPath = plans.find((path) => /test-spec/i.test(path));
	const prd = prdPath ? readFileSync(join(plansRoot, prdPath), "utf8") : "";
	const testSpec = testSpecPath
		? readFileSync(join(plansRoot, testSpecPath), "utf8")
		: "";
	const stateRoot = join(context.repoPath, ".owx", "state");
	const ralplanStates = filesBelow(stateRoot).filter((path) =>
		/ralplan-state\.json$/.test(path),
	);
	const ralplanStateRecords = ralplanStates.flatMap((path) => {
		try {
			const state = JSON.parse(
				readFileSync(join(stateRoot, path), "utf8"),
			) as Record<string, unknown>;
			return [state];
		} catch {
			return [];
		}
	});
	const hasPlanningStopState = ralplanStateRecords.some((state) => {
		try {
			if (state.mode !== "ralplan" || typeof state.current_phase !== "string") {
				return false;
			}
			const phase = state.current_phase
				.trim()
				.toLowerCase()
				.replaceAll("-", "_");
			const complete =
				state.active === false &&
				(phase === "complete" || phase === "completed");
			const approvedPause =
				state.active === true &&
				(phase === "paused" || phase === "paused_for_review");
			return complete || approvedPause;
		} catch {
			return false;
		}
	});
	const hasCompleteConsensusGate = (value: unknown): boolean => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			return false;
		const record = value as Record<string, unknown>;
		const gate = record.ralplan_consensus_gate ?? record.ralplanConsensusGate;
		return Boolean(
			gate &&
				typeof gate === "object" &&
				!Array.isArray(gate) &&
				(gate as Record<string, unknown>).complete === true,
		);
	};
	const planJsonFiles = filesBelow(plansRoot).filter((path) =>
		path.endsWith(".json"),
	);
	const hasApprovedConsensus =
		ralplanStateRecords.some(hasCompleteConsensusGate) ||
		planJsonFiles.some((path) => {
			try {
				return hasCompleteConsensusGate(
					JSON.parse(readFileSync(join(plansRoot, path), "utf8")),
				);
			} catch {
				return false;
			}
		});
	const prdSubstantive =
		prd.length >= 200 && /requirement|constraint|acceptance/i.test(prd);
	const testSpecSubstantive =
		testSpec.length >= 150 &&
		/test|scenario|verification|command/i.test(testSpec);
	const pass =
		status.pass &&
		productChanges.length === 0 &&
		prdSubstantive &&
		testSpecSubstantive &&
		hasPlanningStopState &&
		hasApprovedConsensus;
	return {
		pass,
		score: pass ? 1 : 0,
		details: {
			productChanges,
			plans,
			prdSubstantive,
			testSpecSubstantive,
			ralplanStates,
			planJsonFiles,
			hasPlanningStopState,
			hasApprovedConsensus,
		},
	};
}

function gradeContinuation(context: AstraGraderContext): AstraGrade {
	const result = run(context.repoPath, "node", [
		"--input-type=module",
		"-e",
		"import assert from 'node:assert/strict'; import { slug } from './slug.mjs'; assert.equal(slug('Hello   World'), 'hello-world'); assert.equal(slug('Hello\\t  World'), 'hello-world');",
	]);
	return {
		pass: result.pass,
		score: result.pass ? 1 : 0,
		details: result.details,
	};
}

export function grade(context: AstraGraderContext): AstraGrade {
	switch (context.task.id) {
		case "explanation-no-activation":
			return gradeExplanation(context);
		case "bug-repair":
			return gradeBugRepair(context);
		case "multi-file-change":
			return gradeMultiFile(context);
		case "explicit-strict-workflow":
			return gradeStrictWorkflow(context);
		case "continuation-steering":
			return gradeContinuation(context);
		default:
			throw new Error(`no Astra grader for task: ${context.task.id}`);
	}
}
