import { dirname } from "node:path";
import { createInterface } from "readline/promises";
import {
	type AutoresearchKeepPolicy,
	slugifyMissionName,
} from "../autoresearch/contracts.js";
import {
	type AutoresearchDeepInterviewResult,
	type AutoresearchSeedInputs,
	isLaunchReadyEvaluatorCommand,
	writeAutoresearchDeepInterviewArtifacts,
} from "./autoresearch-intake.js";

export interface InitAutoresearchOptions {
	topic: string;
	evaluatorCommand: string;
	keepPolicy: AutoresearchKeepPolicy;
	slug: string;
	repoRoot: string;
}

export interface InitAutoresearchResult {
	slug: string;
	artifactDir: string;
	missionArtifactPath: string;
	sandboxArtifactPath: string;
	resultPath: string;
}

export interface AutoresearchQuestionIO {
	question(prompt: string): Promise<string>;
	close(): void;
}

function createQuestionIO(): AutoresearchQuestionIO {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return {
		question(prompt: string) {
			return rl.question(prompt);
		},
		close() {
			rl.close();
		},
	};
}

async function promptWithDefault(
	io: AutoresearchQuestionIO,
	prompt: string,
	currentValue?: string,
): Promise<string> {
	const suffix = currentValue?.trim() ? ` [${currentValue.trim()}]` : "";
	const answer = await io.question(`${prompt}${suffix}\n> `);
	return answer.trim() || currentValue?.trim() || "";
}

async function promptAction(
	io: AutoresearchQuestionIO,
	launchReady: boolean,
): Promise<"launch" | "refine"> {
	const answer = (
		await io.question(
			`\nNext step [launch/refine further] (default: ${launchReady ? "launch" : "refine further"})\n> `,
		)
	)
		.trim()
		.toLowerCase();
	if (!answer) return launchReady ? "launch" : "refine";
	if (answer === "launch") return "launch";
	if (answer === "refine further" || answer === "refine" || answer === "r")
		return "refine";
	throw new Error('Please choose either "launch" or "refine further".');
}

function ensureLaunchReadyEvaluator(command: string): void {
	if (!isLaunchReadyEvaluatorCommand(command)) {
		throw new Error(
			"Evaluator command is still a placeholder/template. Refine further before launch.",
		);
	}
}

export function buildAutoresearchDeepInterviewPrompt(
	seedInputs: AutoresearchSeedInputs = {},
): string {
	const seedLines = [
		`- topic: ${seedInputs.topic?.trim() || "(none)"}`,
		`- evaluator: ${seedInputs.evaluatorCommand?.trim() || "(none)"}`,
		`- keep_policy: ${seedInputs.keepPolicy || "(none)"}`,
		`- slug: ${seedInputs.slug?.trim() || "(none)"}`,
	];

	return [
		"$deep-interview --autoresearch",
		"Run the deep-interview skill in autoresearch mode for `$autoresearch`.",
		"Guide the user through research topic definition, evaluator readiness, keep policy, and slug/session naming.",
		"Do not run `owx autoresearch` yourself; direct CLI launch is deprecated. Hand off to `$autoresearch` after confirmation.",
		"When the user confirms launch and the evaluator is concrete, write/update these canonical artifacts under `.owx/specs/`:",
		"- `deep-interview-autoresearch-{slug}.md`",
		"- `autoresearch-{slug}/mission.md`",
		"- `autoresearch-{slug}/sandbox.md`",
		"- `autoresearch-{slug}/result.json`",
		"Use the contract and helper functions in `src/cli/autoresearch-intake.ts` for the artifact shape.",
		"If the evaluator command still contains placeholders or the user has not confirmed launch, keep refining instead of finalizing launch-ready output.",
		"",
		"Seed inputs:",
		...seedLines,
	].join("\n");
}

export async function materializeAutoresearchDeepInterviewResult(
	result: AutoresearchDeepInterviewResult,
): Promise<InitAutoresearchResult> {
	ensureLaunchReadyEvaluator(result.compileTarget.evaluatorCommand);
	return {
		slug: result.compileTarget.slug,
		artifactDir: dirname(result.resultPath),
		missionArtifactPath: result.missionArtifactPath,
		sandboxArtifactPath: result.sandboxArtifactPath,
		resultPath: result.resultPath,
	};
}

export function parseInitArgs(
	args: readonly string[],
): Partial<InitAutoresearchOptions> {
	const result: Partial<InitAutoresearchOptions> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const next = args[i + 1];
		if (arg === "--topic" && next) {
			result.topic = next;
			i++;
		} else if (arg === "--evaluator" && next) {
			result.evaluatorCommand = next;
			i++;
		} else if (arg === "--keep-policy" && next) {
			const normalized = next.trim().toLowerCase();
			if (normalized !== "pass_only" && normalized !== "score_improvement") {
				throw new Error(
					"--keep-policy must be one of: score_improvement, pass_only",
				);
			}
			result.keepPolicy = normalized;
			i++;
		} else if (arg === "--slug" && next) {
			result.slug = slugifyMissionName(next);
			i++;
		} else if (arg.startsWith("--topic=")) {
			result.topic = arg.slice("--topic=".length);
		} else if (arg.startsWith("--evaluator=")) {
			result.evaluatorCommand = arg.slice("--evaluator=".length);
		} else if (arg.startsWith("--keep-policy=")) {
			const normalized = arg
				.slice("--keep-policy=".length)
				.trim()
				.toLowerCase();
			if (normalized !== "pass_only" && normalized !== "score_improvement") {
				throw new Error(
					"--keep-policy must be one of: score_improvement, pass_only",
				);
			}
			result.keepPolicy = normalized;
		} else if (arg.startsWith("--slug=")) {
			result.slug = slugifyMissionName(arg.slice("--slug=".length));
		} else if (arg.startsWith("--")) {
			throw new Error(`Unknown init flag: ${arg.split("=")[0]}`);
		}
	}
	return result;
}

export async function runAutoresearchNoviceBridge(
	repoRoot: string,
	seedInputs: AutoresearchSeedInputs = {},
	io: AutoresearchQuestionIO = createQuestionIO(),
): Promise<InitAutoresearchResult> {
	if (!process.stdin.isTTY) {
		throw new Error(
			"Guided setup requires an interactive terminal. Use `--topic/--evaluator/--keep-policy/--slug` to seed deep-interview intake before launching `$autoresearch`.",
		);
	}

	let topic = seedInputs.topic?.trim() || "";
	let evaluatorCommand = seedInputs.evaluatorCommand?.trim() || "";
	let keepPolicy: AutoresearchKeepPolicy =
		seedInputs.keepPolicy || "score_improvement";
	let slug = seedInputs.slug?.trim() || "";
	try {
		while (true) {
			topic = await promptWithDefault(io, "Research topic/goal", topic);
			if (!topic) {
				throw new Error("Research topic is required.");
			}

			const evaluatorIntent = await promptWithDefault(
					io,
					"\nHow should OWX judge success? Describe it in plain language",
					topic,
			);
			evaluatorCommand = await promptWithDefault(
					io,
					"\nEvaluator command (leave placeholder to refine further; must output {pass:boolean, score?:number} JSON before launch)",
					evaluatorCommand ||
						`TODO replace with evaluator command for: ${evaluatorIntent}`,
			);

			const keepPolicyInput = await promptWithDefault(
					io,
					"\nKeep policy [score_improvement/pass_only]",
					keepPolicy,
			);
			keepPolicy =
				keepPolicyInput.trim().toLowerCase() === "pass_only"
					? "pass_only"
					: "score_improvement";

			slug = await promptWithDefault(
					io,
					"\nMission slug",
					slug || slugifyMissionName(topic),
			);
			slug = slugifyMissionName(slug);

			const deepInterview = await writeAutoresearchDeepInterviewArtifacts({
				repoRoot,
				topic,
				evaluatorCommand,
				keepPolicy,
				slug,
				seedInputs,
			});

			console.log(`\nDraft saved: ${deepInterview.draftArtifactPath}`);
			console.log(
				`Launch readiness: ${deepInterview.launchReady ? "ready" : deepInterview.blockedReasons.join(" ")}`,
			);

			const action = await promptAction(io, deepInterview.launchReady);
			if (action === "refine") continue;
			return materializeAutoresearchDeepInterviewResult(deepInterview);
		}
	} finally {
		io.close();
	}
}

export async function guidedAutoresearchSetup(
	repoRoot: string,
): Promise<InitAutoresearchResult> {
	return runAutoresearchNoviceBridge(repoRoot, {}, createQuestionIO());
}
