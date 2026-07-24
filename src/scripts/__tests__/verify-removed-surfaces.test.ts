import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createRemovedSurfaceContract,
	formatSurfaceDiagnostic,
	type InspectionFile,
	inspectRemovedSurfaces,
} from "../verify-removed-surfaces.js";

const token = (...parts: string[]): string => parts.join("");

describe("verify-removed-surfaces", () => {
	it("reports removed paths and content with deterministic file:line diagnostics", () => {
		const files: InspectionFile[] = [
			{
				path: token("src/", "team", "/runtime.ts"),
				content: "export const retained = false;\n",
			},
			{
				path: "src/example.ts",
				content: [
					"const safe = true;",
					token("const command = 'owx ", "team';"),
				].join("\n"),
			},
		];

		const diagnostics = inspectRemovedSurfaces(files);

		assert.ok(diagnostics.some((item) => item.ruleId === "team-tree"));
		const command = diagnostics.find((item) => item.ruleId === "team-command");
		assert.ok(command);
		assert.equal(command.path, "src/example.ts");
		assert.equal(command.line, 2);
		assert.match(formatSurfaceDiagnostic(command), /^src\/example\.ts:2:\d+ /);
	});

	it(
		token(
			"covers terminal multiplexing, Rust runtime, inbound session, Question, and Side",
			"car contracts",
		),
		() => {
			const values = [
				token("tm", "ux"),
				token("owx-", "runtime-core"),
				token("OWX_RUNTIME_", "BRIDGE"),
				token("reply-", "listener"),
				token("session-", "registry"),
				token("owx ", "question"),
				token("side", "car"),
			];
			const diagnostics = inspectRemovedSurfaces([
				{ path: "src/contracts.ts", content: values.join("\n") },
			]);
			const ids = new Set(diagnostics.map((item) => item.ruleId));

			for (const expected of [
				token("tm", "ux"),
				"runtime-core",
				"runtime-bridge-env",
				token("reply", "-listener"),
				token("session", "-registry"),
				"question-command",
				token("side", "car"),
			]) {
				assert.ok(ids.has(expected), `missing diagnostic for ${expected}`);
			}
		},
	);

	it("allows identifiers only in the three exact allowlist categories", () => {
		const contract = createRemovedSurfaceContract();
		const marker = token("tm", "ux");
		const allowed = contract.allowContentOnlyIn;
		assert.equal(typeof allowed.inertnessFixture, "string");
		assert.equal(typeof allowed.migrationTombstone, "string");
		assert.equal(typeof allowed.changelog, "string");

		const diagnostics = inspectRemovedSurfaces(
			[
				{ path: allowed.inertnessFixture as string, content: marker },
				{ path: allowed.migrationTombstone as string, content: marker },
				{ path: allowed.changelog as string, content: marker },
				{ path: "docs/history.md", content: marker },
			],
			contract,
		);

		assert.equal(diagnostics.length, 1);
		assert.equal(diagnostics[0]?.path, "docs/history.md");
		assert.equal(diagnostics[0]?.ruleId, token("tm", "ux"));
	});

	it("rejects notification reply and fallback watcher residue", () => {
		const diagnostics = inspectRemovedSurfaces([
			{
				path: token("src/scripts/notify-", "fallback-watcher.ts"),
				content: token("const state = 'notify-", "fallback-state.json';"),
			},
			{
				path: "src/example.ts",
				content: [
					token("sdk.owx.notify", "Fallback.read()"),
					token("notifications.", "reply.enabled"),
					token("OWX_REPLY_", "ENABLED"),
					token("reply ", "listener"),
				].join("\n"),
			},
		]);
		const ids = new Set(diagnostics.map((item) => item.ruleId));
		for (const expected of [
			token("notify-", "fallback-watcher-path"),
			token("notify-", "fallback-state"),
			token("notify-", "fallback-api"),
			"notification-reply-config",
			"notification-reply-env",
			token("reply-", "listener-phrase"),
		]) assert.ok(ids.has(expected), `missing diagnostic for ${expected}`);
	});

	it("accepts an injected contract without self-matching its scanner implementation", () => {
		const diagnostics = inspectRemovedSurfaces(
			[{ path: "src/a.ts", content: "first\nforbidden-value\n" }],
			{
				forbiddenPaths: [],
				forbiddenContent: [{ id: "injected", source: "forbidden-value" }],
				allowContentOnlyIn: {
					inertnessFixture: "fixture.json",
					migrationTombstone: "migration.ts",
					changelog: "CHANGELOG.md",
				},
			},
		);

		assert.deepEqual(
			diagnostics.map(({ path, line, ruleId }) => ({ path, line, ruleId })),
			[{ path: "src/a.ts", line: 2, ruleId: "injected" }],
		);
	});
});
