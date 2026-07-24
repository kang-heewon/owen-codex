import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readAllState } from "../../hud/state.js";

interface InertnessFixture {
	environment: Record<string, string>;
	stateFiles: Array<{ path: string; content: Record<string, unknown> }>;
	unsupportedCommands: string[][];
	expected: {
		workflowActivation: boolean;
		hudProjection: boolean;
		stateCreated: boolean;
	};
}

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const owxBin = join(repoRoot, "dist", "cli", "owx.js");
const fixturePath = join(
	repoRoot,
	"src",
	"cli",
	"__tests__",
	"fixtures",
	["removed", "surfaces", "inertness.json"].join("-"),
);

async function readFixture(): Promise<InertnessFixture> {
	return JSON.parse(await readFile(fixturePath, "utf8")) as InertnessFixture;
}

describe("removed command and state inertness", () => {
	it("ignores stale environment and state while rejecting retired commands", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "owx-retired-inertness-"));
		const fixture = await readFixture();
		try {
			for (const file of fixture.stateFiles) {
				const target = join(cwd, ...file.path.split("/"));
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, JSON.stringify(file.content));
			}

			const state = await readAllState(cwd);
			assert.equal(state.ralph, null);
			assert.equal(state.autopilot, null);
			assert.equal(state.ultrawork, null);
			assert.equal(fixture.expected.workflowActivation, false);
			assert.equal(fixture.expected.hudProjection, false);

			for (const argv of fixture.unsupportedCommands) {
				const result = spawnSync(process.execPath, [owxBin, ...argv], {
					cwd,
					encoding: "utf8",
					env: {
						...process.env,
						...fixture.environment,
						OWX_AUTO_UPDATE: "0",
						OWX_HOOK_DERIVED_SIGNALS: "0",
					},
				});
				assert.notEqual(result.status, 0, result.stderr || result.stdout);
				assert.match(`${result.stderr}${result.stdout}`, /unknown|unsupported/i);
			}

			assert.equal(fixture.expected.stateCreated, false);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
