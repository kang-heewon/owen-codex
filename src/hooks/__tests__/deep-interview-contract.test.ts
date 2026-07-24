import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readProjectAgents(startDir: string): string {
	let currentDir = startDir;

	while (true) {
		const candidate = join(currentDir, "AGENTS.md");
		if (existsSync(candidate)) {
			const content = readFileSync(candidate, "utf-8");
			if (!/Team Worker Runtime Instructions/i.test(content)) {
				return content;
			}
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}

	return readFileSync(join(startDir, "AGENTS.md"), "utf-8");
}

const deepInterviewSkill = readFileSync(
	join(__dirname, "../../../skills/deep-interview/SKILL.md"),
	"utf-8",
);
const pluginDeepInterviewSkill = readFileSync(
	join(__dirname, "../../../plugins/owen-codex/skills/deep-interview/SKILL.md"),
	"utf-8",
);
const autopilotSkill = readFileSync(
	join(__dirname, "../../../skills/autopilot/SKILL.md"),
	"utf-8",
);
const templateAgents = readFileSync(
	join(__dirname, "../../../templates/AGENTS.md"),
	"utf-8",
);
const rootAgentsPath = join(__dirname, "../../../AGENTS.md");
const rootAgents = existsSync(rootAgentsPath)
	? readProjectAgents(join(__dirname, "../../.."))
	: null;

describe("deep-interview Ouroboros contract", () => {
	it("includes ambiguity gate math and intent-first scoring", () => {
		assert.match(deepInterviewSkill, /ambiguity/i);
		assert.match(deepInterviewSkill, /threshold/i);
		assert.match(deepInterviewSkill, /Greenfield: `ambiguity =/);
		assert.match(deepInterviewSkill, /Brownfield: `ambiguity =/);
		assert.match(deepInterviewSkill, /intent × 0\.30/i);
		assert.match(deepInterviewSkill, /Decision Boundaries/i);
	});

	it("adds intent-first concepts and readiness gates", () => {
		assert.match(deepInterviewSkill, /Intent \(why the user wants this\)/i);
		assert.match(deepInterviewSkill, /Desired Outcome/i);
		assert.match(deepInterviewSkill, /Out-of-Scope \/ Non-goals/i);
		assert.match(deepInterviewSkill, /Decision Boundaries/i);
		assert.match(deepInterviewSkill, /Reduce user effort/i);
		assert.match(deepInterviewSkill, /must be explicit/i);
		assert.match(deepInterviewSkill, /pressure pass/i);
	});

	it("prioritizes intent-boundary questioning before implementation detail", () => {
		const intentFirstIndex = deepInterviewSkill.indexOf(
			"Ask about intent and boundaries before implementation detail",
		);
		const weakDimIndex = deepInterviewSkill.indexOf(
			"Target the lowest-scoring dimension, but respect stage priority",
		);
		const artifactIndex = deepInterviewSkill.indexOf("Spec should include:");

		assert.notEqual(intentFirstIndex, -1);
		assert.notEqual(weakDimIndex, -1);
		assert.notEqual(artifactIndex, -1);
		assert.ok(intentFirstIndex < artifactIndex);
		assert.ok(weakDimIndex < artifactIndex);
	});
	it("includes challenge mode structure", () => {
		assert.match(deepInterviewSkill, /Contrarian/i);
		assert.match(deepInterviewSkill, /Simplifier/i);
		assert.match(deepInterviewSkill, /Ontologist/i);
	});

	it("strengthens questioning pressure on all four analysis axes", () => {
		assert.match(
			deepInterviewSkill,
			/Treat every answer as a claim to pressure-test before moving on/i,
		);
		assert.match(
			deepInterviewSkill,
			/demand evidence or examples, expose a hidden assumption, force a tradeoff or boundary, or reframe root cause vs symptom/i,
		);
		assert.match(
			deepInterviewSkill,
			/Do not rotate to a new clarity dimension just for coverage/i,
		);
		assert.match(
			deepInterviewSkill,
			/Prefer staying on the same thread for multiple rounds when it has the highest leverage/i,
		);
		assert.match(
			deepInterviewSkill,
			/Do not offer early exit before the first explicit assumption probe and one persistent follow-up have happened/i,
		);
		assert.match(
			deepInterviewSkill,
			/Round 4\+: allow explicit early exit with risk warning/i,
		);
	});

	it("prevents continuing ordinary questions after ambiguity falls below threshold", () => {
		assert.match(deepInterviewSkill, /Profile `max rounds` is a hard cap, not a target/i);
		assert.match(deepInterviewSkill, /Do not continue only to reach a numbered round count/i);
		assert.match(deepInterviewSkill, /Extra Socratic rigor does not override the active threshold/i);
		assert.match(deepInterviewSkill, /stop ordinary questioning/i);
		assert.match(deepInterviewSkill, /crystallize\/handoff when readiness gates pass/i);
		assert.match(deepInterviewSkill, /<= 0\.10.*final closure question/i);
		assert.match(autopilotSkill, /not a one-question gate; `max_rounds` is a cap, not a target/i);
		assert.match(autopilotSkill, /Ask another question only when a readiness gate is still unresolved/i);
	});

	it("adds Ouroboros-style rhythm, breadth, and practical closure guards", () => {
		assert.match(deepInterviewSkill, /Breadth Ledger/i);
		assert.match(deepInterviewSkill, /scope, constraints, outputs, verification, brownfield integration/i);
		assert.match(deepInterviewSkill, /guard, not a mandatory rotation rule/i);
		assert.match(deepInterviewSkill, /zoom out only when another material track remains unresolved/i);
		assert.match(deepInterviewSkill, /practical closure audit/i);
		assert.match(deepInterviewSkill, /another question would change execution materially/i);
		assert.match(deepInterviewSkill, /not merely polish wording or chase a narrow edge case/i);
		assert.match(deepInterviewSkill, /low ambiguity score as permission to audit closure/i);
		assert.match(deepInterviewSkill, /Dialectic Rhythm Guard/i);
		assert.match(deepInterviewSkill, /After 3 consecutive non-user or confirmation answers/i);
		assert.match(deepInterviewSkill, /must solicit direct human judgment/i);
	});

	it("grounds brownfield interviews in repo context, terminology, and scenarios", () => {
		assert.match(
			deepInterviewSkill,
			/context grounding before user-facing questions/i,
		);
		assert.match(deepInterviewSkill, /applicable `AGENTS\.md` files/i);
		assert.match(deepInterviewSkill, /`CONTEXT\.md` or `CONTEXT-MAP\.md`/i);
		assert.match(deepInterviewSkill, /Terminology Ledger/i);
		assert.match(deepInterviewSkill, /canonical terms already used by the repo/i);
		assert.match(deepInterviewSkill, /user terms that conflict with current code behavior or local context/i);
		assert.match(
			deepInterviewSkill,
			/Cross-check user claims about current behavior against code and local context artifacts/i,
		);
		assert.match(
			deepInterviewSkill,
			/If sources disagree, ask a confirmation question that names both sources/i,
		);
		assert.match(deepInterviewSkill, /Terminologist/i);
		assert.match(
			deepInterviewSkill,
			/Stress-test the boundary with one concrete scenario or edge case/i,
		);
	});

	it("moves challenge modes and preserved evidence discipline earlier", () => {
		assert.match(
			deepInterviewSkill,
			/Contrarian.*round 2\+.*untested assumption/i,
		);
		assert.match(
			deepInterviewSkill,
			/Simplifier.*round 4\+.*scope expands faster than outcome clarity/i,
		);
		assert.match(
			deepInterviewSkill,
			/Ontologist.*round 5\+.*ambiguity > 0\.25.*describing symptoms/i,
		);
		assert.match(
			deepInterviewSkill,
			/Brownfield evidence vs inference notes/i,
		);
	});

	it("documents optional execution contract foundation for Autopilot stride handoff", () => {
		assert.match(deepInterviewSkill, /Optional execution contract foundation/i);
		assert.match(deepInterviewSkill, /execution_contract_required/i);
		assert.match(deepInterviewSkill, /execution_contract/i);
		assert.match(deepInterviewSkill, /execution_stride/i);
		assert.match(deepInterviewSkill, /task.*deliverable.*milestone/s);
		assert.match(deepInterviewSkill, /allow_task_shrink/i);
		assert.match(deepInterviewSkill, /completion_unit/i);
		assert.match(deepInterviewSkill, /stop_condition/i);
		assert.match(deepInterviewSkill, /acceptance_coverage_scope/i);
		assert.match(deepInterviewSkill, /shrink_policy/i);
		assert.match(deepInterviewSkill, /do not infer stride from task length, phase labels, snapshots, or freeform wording/i);
		assert.match(deepInterviewSkill, /New artifacts must write the canonical snake_case schema/i);
		assert.match(deepInterviewSkill, /runtime readers may accept legacy camelCase field\/marker aliases and direct\/nested `execution_contract` locations only as compatibility input/i);
		assert.match(pluginDeepInterviewSkill, /Optional execution contract foundation/i);
	});

	it("preserves clarified intent and boundary constraints across execution handoff", () => {
		assert.match(
			deepInterviewSkill,
			/preserve intent, non-goals, decision boundaries, acceptance criteria/i,
		);
		assert.match(deepInterviewSkill, /binding context/i);
		assert.match(deepInterviewSkill, /verification evidence tracked against the clarified criteria/i);
	});

	it("uses OWX-native output paths", () => {
		assert.match(deepInterviewSkill, /\.owx\/interviews\//);
		assert.match(deepInterviewSkill, /\.owx\/specs\//);
	});

	it("documents total prompt-budget hardening for retained context", () => {
		assert.match(deepInterviewSkill, /Keep total prompt payloads within a safe budget/i);
		assert.match(deepInterviewSkill, /summarizing or trimming retained history/i);
		assert.match(deepInterviewSkill, /preserve newest\/highest-signal answers/i);
		assert.match(deepInterviewSkill, /Prompt-safe initial-context summary when oversized context was provided/i);
		assert.match(deepInterviewSkill, /summary gate is not needed, pending, or satisfied/i);
		assert.match(deepInterviewSkill, /before any scoring or handoff step/i);
	});

	it("requires preflight context intake before interview rounds", () => {
		assert.match(deepInterviewSkill, /Phase 0: Preflight Context Intake/i);
		assert.match(
			deepInterviewSkill,
			/preflight context intake before the first interview question/i,
		);
		assert.match(
			deepInterviewSkill,
			/\.owx\/context\/\{slug\}-\{timestamp\}\.md/,
		);
		assert.match(deepInterviewSkill, /context_snapshot_path/i);
	});

});

describe("cross-skill and AGENTS coherence for deep-interview", () => {
	it("autopilot references deep-interview handoff", () => {
		assert.match(autopilotSkill, /deep-interview/i);
		assert.match(autopilotSkill, /Socratic/i);
	});

	it("plugin mirror keeps the deep-interview skill aligned", () => {
		assert.equal(pluginDeepInterviewSkill, deepInterviewSkill);
	});

	it("tracked AGENTS surfaces include ouroboros keyword and updated description", () => {
		if (rootAgents != null) {
			assert.match(rootAgents, /ouroboros/i);
			assert.match(rootAgents, /Socratic deep interview/i);
		}
		assert.match(templateAgents, /ouroboros/i);
		assert.match(templateAgents, /Socratic deep interview/i);
	});

});
