import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { AGENT_DEFINITIONS } from "../../agents/definitions.js";
import { KEYWORD_TRIGGER_DEFINITIONS } from "../keyword-registry.js";

const repoRoot = join(import.meta.dirname, "../../..");
const canonicalRoot = join(repoRoot, "skills", "prose-quality");
const pluginRoot = join(
	repoRoot,
	"plugins",
	"owen-codex",
	"skills",
	"prose-quality",
);

const requiredFiles = [
	"SKILL.md",
	"fixtures/ko-register-pairs.md",
	"fixtures/ko-structure-pairs.md",
	"fixtures/preservation-cases.md",
	"fixtures/technical-writing-cases.md",
	"references/examples.md",
	"references/korean.md",
	"references/patterns.md",
	"references/preservation.md",
	"references/technical-writing.md",
] as const;

function read(path: string): string {
	return readFileSync(join(repoRoot, path), "utf8");
}

function readSkillFile(relativePath: (typeof requiredFiles)[number]): string {
	return readFileSync(join(canonicalRoot, relativePath), "utf8");
}

function markdownFiles(root: string, current = root): string[] {
	if (!existsSync(current)) return [];

	return readdirSync(current)
		.flatMap((entry) => {
			const path = join(current, entry);
			if (statSync(path).isDirectory()) return markdownFiles(root, path);
			return entry.endsWith(".md") ? [relative(root, path)] : [];
		})
		.sort();
}

function assertMatchesAll(content: string, patterns: readonly RegExp[]): void {
	for (const pattern of patterns) assert.match(content, pattern);
}

function sectionFor(content: string, heading: string): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(
		`^##\\s+${escapedHeading}\\s*$([\\s\\S]*?)(?=^##\\s)`,
		"m",
	).exec(`${content}\n## fixture-end`);
	assert.ok(match, `expected a level-two fixture section for ${heading}`);
	return match[1] ?? "";
}

function subsectionFor(content: string, headingPrefix: string): string {
	const escapedHeading = headingPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(
		`^###\\s+${escapedHeading}[^\\n]*$([\\s\\S]*?)(?=^###\\s|^##\\s)`,
		"m",
	).exec(`${content}\n## fixture-end`);
	assert.ok(
		match,
		`expected a level-three fixture section for ${headingPrefix}`,
	);
	return match[1] ?? "";
}

describe("prose-quality skill contract", () => {
	it("keeps the canonical skill structure complete and exactly mirrored by the plugin", () => {
		assert.deepEqual(markdownFiles(canonicalRoot), [...requiredFiles]);
		assert.deepEqual(markdownFiles(pluginRoot), [...requiredFiles]);

		for (const relativePath of requiredFiles) {
			const canonicalPath = join(canonicalRoot, relativePath);
			const pluginPath = join(pluginRoot, relativePath);
			assert.ok(
				existsSync(canonicalPath),
				`missing canonical prose-quality file: ${relativePath}`,
			);
			assert.ok(
				existsSync(pluginPath),
				`missing plugin prose-quality file: ${relativePath}`,
			);
			assert.equal(
				readFileSync(pluginPath, "utf8"),
				readFileSync(canonicalPath, "utf8"),
				`plugin prose-quality file must match canonical: ${relativePath}`,
			);
		}
	});

	it("makes preservation a gate and limits cleanup to the minimum effective edit", () => {
		const skill = readSkillFile("SKILL.md");
		const preservation = readSkillFile("references/preservation.md");
		const patterns = readSkillFile("references/patterns.md");
		const cases = readSkillFile("fixtures/preservation-cases.md");
		const contract = [skill, preservation, patterns, cases].join("\n");

		assertMatchesAll(contract, [
			/preserv(?:e|ation)[\s\S]{0,100}(?:facts?|factual claims?)/i,
			/numbers?/i,
			/dates?/i,
			/URLs?/i,
			/uncertainty/i,
			/(?:code|API) identifiers?/i,
			/exact quotes?/i,
			/(?:source|author(?:'s)?) voice/i,
			/(?:do not|never) invent[\s\S]{0,100}(?:specificity|metrics?|quotes?|benchmarks?|examples?)/i,
			/minimum effective edits?/i,
		]);

		assertMatchesAll(cases, [
			/(?:number|date|URL)/i,
			/uncertainty/i,
			/(?:code|identifier|quote)/i,
			/(?:preserve|unchanged|must remain)/i,
		]);
	});

	it("treats Korean translationese as a contextual register issue, not a word blacklist", () => {
		const korean = readSkillFile("references/korean.md");
		const registerPairs = readSkillFile("fixtures/ko-register-pairs.md");
		const structurePairs = readSkillFile("fixtures/ko-structure-pairs.md");

		assertMatchesAll(korean, [
			/(?:translationese|직역투)/i,
			/(?:context|맥락|도메인)[\s\S]{0,160}(?:register|어휘|표현|용어)/i,
			/(?:practitioner|실무자|화자|독자)[\s\S]{0,120}(?:natural|자연|실제로)/i,
			/(?:(?:not|아니)[\s\S]{0,80}(?:ban(?:ned)?|blacklist|금지어)|금지어[\s\S]{0,40}아니)/i,
			/(?:전문 용어|technical (?:term|vocabulary)|정착된)/i,
		]);

		const pairedTerms = new Map<string, RegExp>([
			["배선", /배선/],
			["계측", /계측/],
			["노출", /노출/],
			["소비", /소비/],
			["주입", /주입/],
			["전파", /전파/],
			["활용", /활용(?:하|해|한|할|했)/],
			["취하다", /취(?:하|해|한|할)/],
		]);

		for (const [term, lemmaPattern] of pairedTerms) {
			const section = sectionFor(registerPairs, term);
			const rewriteCase = subsectionFor(section, "Rewrite candidate");
			const preserveCase = subsectionFor(section, "Preserve");
			assert.match(
				rewriteCase,
				lemmaPattern,
				`${term} rewrite case must use the lemma`,
			);
			assert.match(
				preserveCase,
				lemmaPattern,
				`${term} preserve case must use the lemma`,
			);
		}

		for (const phrase of ["이를 통해", "단순히", "해당"])
			assert.match(structurePairs, new RegExp(phrase));
		assert.match(structurePairs, /passive|피동/i);
		assert.match(structurePairs, /rewrite/i);
		assert.match(structurePairs, /preserve/i);
	});

	it("keeps technical prose subordinate to correctness and protected technical semantics", () => {
		const technical = readSkillFile("references/technical-writing.md");
		const cases = readSkillFile("fixtures/technical-writing-cases.md");
		const contract = [technical, cases].join("\n");

		assert.match(technical, /correctness[\s\S]{0,240}readability/i);
		assertMatchesAll(contract, [
			/MUST[\s\S]{0,100}SHOULD[\s\S]{0,100}MAY/,
			/identifiers?/i,
			/commands?/i,
			/config(?:uration)? (?:keys?|fields?)/i,
			/API (?:paths?|names?|terms?|identifiers?)/i,
			/failure modes?/i,
			/exceptions?/i,
			/(?:repository-local|local (?:code|tests?|build|verification|evidence)|do not call production)/i,
		]);
		assert.match(
			cases,
			/(?:simplif|rewrite|edit|변경|단순화)[\s\S]{0,160}(?:meaning|semantics?|requirement|exception|failure|의미|요구|예외|실패)/i,
		);
	});

	it("does not grow duplicate prose, agent, CLI, or broad keyword surfaces", () => {
		assert.equal(
			existsSync(join(repoRoot, "skills", "technical-writing")),
			false,
		);
		assert.equal(
			existsSync(
				join(repoRoot, "plugins", "owen-codex", "skills", "technical-writing"),
			),
			false,
		);
		assert.equal(
			existsSync(join(repoRoot, "prompts", "technical-writer.md")),
			false,
		);
		assert.equal(Object.hasOwn(AGENT_DEFINITIONS, "technical-writer"), false);

		const cli = read("src/cli/index.ts");
		for (const command of ["prose", "humanize", "sloplint", "writing-score"]) {
			assert.doesNotMatch(
				cli,
				new RegExp(
					`(?:case\\s+['\"]${command}['\"]|\\bowx\\s+${command}\\b)`,
					"i",
				),
			);
		}

		const broadHumanizeKeywords = KEYWORD_TRIGGER_DEFINITIONS.filter(
			({ keyword }) =>
				/humaniz|remove ai|translationese|make (?:this |it )?natural/i.test(
					keyword,
				),
		);
		assert.deepEqual(broadHumanizeKeywords, []);
	});
});
