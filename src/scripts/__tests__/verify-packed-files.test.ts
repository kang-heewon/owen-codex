import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createPackedFilesContract,
	inspectPackedFiles,
	parseNpmPackDryRunJson,
} from "../verify-packed-files.js";

const token = (...parts: string[]): string => parts.join("");

describe("verify-packed-files", () => {
	it("parses npm pack dry-run JSON after lifecycle logs", () => {
		const inventory = parseNpmPackDryRunJson(
			[
				"> prepack",
				"build complete",
				JSON.stringify([
					{
						filename: "package.tgz",
						files: [{ path: "dist/index.js", size: 42 }],
					},
				]),
			].join("\n"),
		);

		assert.deepEqual(inventory, [{ path: "dist/index.js", size: 42 }]);
	});

	it("rejects tests, inertness fixtures, and removed runtime paths", () => {
		const diagnostics = inspectPackedFiles([
			{ path: "package/dist/cli/__tests__/command.test.js" },
			{
				path: token(
					"package/src/cli/__tests__/fixtures/removed-",
					"surfaces-inertness.json",
				),
			},
			{ path: token("package/crates/owx-", "runtime/src/lib.rs") },
		]);
		const ids = new Set(diagnostics.map((item) => item.ruleId));

		assert.ok(ids.has("packed-test-or-fixture"));
		assert.ok(ids.has("runtime-crate"));
	});

	it("rejects removed identifiers in packed content with file:line evidence", () => {
		const diagnostics = inspectPackedFiles([
			{
				path: "package/dist/launcher.js",
				content: [
					"export const launcher = {};",
					token("// uses ", "session-", "status"),
				].join("\n"),
			},
		]);

		assert.equal(diagnostics.length, 1);
		assert.equal(diagnostics[0]?.path, "dist/launcher.js");
		assert.equal(diagnostics[0]?.line, 2);
		assert.equal(diagnostics[0]?.ruleId, token("session", "-status"));
	});

	it("rejects packed notification fallback assets and APIs", () => {
		const diagnostics = inspectPackedFiles([
			{
				path: token("package/dist/scripts/notify-", "fallback-watcher.js"),
				content: token("sdk.owx.notify", "Fallback.read()"),
			},
		]);
		const ids = new Set(diagnostics.map((item) => item.ruleId));
		assert.ok(ids.has(token("packed-notify-", "fallback-watcher-path")));
		assert.ok(ids.has(token("notify-", "fallback-api")));
	});

	it("permits removed identifiers only in explicitly listed packed tombstone outputs and changelog", () => {
		const contract = createPackedFilesContract();
		const tombstones =
			contract.removedSurfaces.allowContentOnlyIn.migrationTombstone;
		assert.ok(Array.isArray(tombstones));
		const marker = token("OWX_RUNTIME_", "BINARY");
		const diagnostics = inspectPackedFiles(
			[
				...(tombstones as readonly string[]).map((path) => ({
					path,
					content: marker,
				})),
				{ path: "package/CHANGELOG.md", content: marker },
				{ path: "package/dist/other.js", content: marker },
			],
			contract,
		);

		assert.equal(diagnostics.length, 1);
		assert.equal(diagnostics[0]?.path, "dist/other.js");
		assert.equal(diagnostics[0]?.ruleId, "runtime-binary-env");
	});

	it("rejects malformed or content-free npm output", () => {
		assert.throws(
			() => parseNpmPackDryRunJson("npm notice no json inventory"),
			/did not produce a valid JSON file inventory/,
		);
	});
});
