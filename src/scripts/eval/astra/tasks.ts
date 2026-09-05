export interface AstraEvalTask {
	id: string;
	description: string;
	files: Record<string, string>;
	prompts: string[];
}

export const ASTRA_EVAL_TASKS: readonly AstraEvalTask[] = [
	{
		id: "explanation-no-activation",
		description:
			"Short explanation requests must not activate an execution workflow.",
		files: {
			"src/format.mjs":
				"export function formatName(first, last) {\n  return `${last}, ${first}`;\n}\n",
		},
		prompts: [
			"I want a short explanation of src/format.mjs. Do not edit files.",
		],
	},
	{
		id: "bug-repair",
		description: "A bounded defect is fixed and verified.",
		files: {
			"package.json": '{"type":"module","scripts":{"test":"node --test"}}\n',
			"sum.mjs":
				"export function sum(values) {\n  return values.reduce((total, value) => total - value, 0);\n}\n",
			"sum.test.mjs":
				"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from './sum.mjs';\ntest('adds values', () => assert.equal(sum([2, 3, 4]), 9));\n",
		},
		prompts: ["Fix the failing sum implementation and run the relevant test."],
	},
	{
		id: "multi-file-change",
		description:
			"A small feature is implemented coherently across multiple files.",
		files: {
			"package.json": '{"type":"module","scripts":{"test":"node --test"}}\n',
			"src/store.mjs": "export const records = new Map();\n",
			"src/user.mjs":
				"import { records } from './store.mjs';\nexport function saveUser(user) { records.set(user.id, user); }\n",
			"user.test.mjs":
				"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { saveUser, findUser } from './src/user.mjs';\ntest('saves and finds a user', () => { saveUser({ id: 'u1', name: 'Ada' }); assert.equal(findUser('u1')?.name, 'Ada'); });\n",
		},
		prompts: [
			"Implement src/find-user.mjs and re-export findUser from src/user.mjs so the user store supports lookup, then run the test.",
		],
	},
	{
		id: "explicit-strict-workflow",
		description:
			"An explicit strict planning workflow remains explicit and scoped.",
		files: {
			"package.json": '{"type":"module","scripts":{"test":"node --test"}}\n',
			"src/cache.mjs": [
				"export function createCache() {",
				"  const entries = new Map();",
				"  return {",
				"    set(key, value) { entries.set(key, { value, storedAt: Date.now() }); },",
				"    get(key) { return entries.get(key)?.value; },",
				"  };",
				"}",
				"",
			].join("\n"),
			"cache.test.mjs": [
				"import test from 'node:test';",
				"import assert from 'node:assert/strict';",
				"import { createCache } from './src/cache.mjs';",
				"test('preserves values and key identity', () => {",
				"  const cache = createCache();",
				"  const key = {};",
				"  cache.set(key, 'value');",
				"  assert.equal(cache.get(key), 'value');",
				"  assert.equal(cache.get({}), undefined);",
				"});",
				"",
			].join("\n"),
			"requirements.md":
				"# Cache TTL\nPlan a change to createCache({ ttlMs } = {}) in src/cache.mjs. Omitted ttlMs preserves unlimited lifetime; a supplied ttlMs must be a positive finite number, otherwise throw RangeError. Expire lazily on get when Date.now() - storedAt >= ttlMs, delete the expired entry, and return undefined. Each set resets the entry timestamp. Preserve Map key identity, all cached values, and the existing no-argument API. No background timer, persistence, dependency, or unrelated API change. Use the existing node:test setup and mocked time to verify before/at/after expiry, reset-on-set, default lifetime, invalid TTL, and object-key identity. Produce the plan and test specification only; do not edit implementation or tests.\n",
		},
		prompts: [
			"$ralplan Create an implementation-ready plan for requirements.md. Do not implement it.",
		],
	},
	{
		id: "continuation-steering",
		description:
			"A later steering instruction supersedes the earlier implementation detail.",
		files: {
			"package.json": '{"type":"module","scripts":{"test":"node --test"}}\n',
			"slug.mjs":
				"export function slug(value) { return value.toLowerCase().replaceAll(' ', '-'); }\n",
			"slug.test.mjs":
				"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { slug } from './slug.mjs';\ntest('normalizes whitespace runs', () => assert.equal(slug('Hello   World'), 'hello-world'));\n",
		},
		prompts: [
			"Inspect the slug implementation and write PROGRESS.md with the smallest proposed fix. Do not edit slug.mjs yet.",
			"Continue from PROGRESS.md. Steering update: collapse every whitespace run, including tabs, to one hyphen. Implement this requirement and run the test.",
		],
	},
] as const;
