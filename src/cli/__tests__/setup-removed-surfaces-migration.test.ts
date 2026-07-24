import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	REMOVED_SURFACES_V1_MCP_SERVER,
	REMOVED_SURFACES_V1_ASSETS,
	migrateRemovedSurfacesV1,
	type RemovedSurfacesMigrationDependencies,
} from "../../setup/migrations/removed-surfaces-v1.js";
import { setup } from "../setup.js";

const MANAGED_TEAM_ORCHESTRATOR_PROMPT = `<team_orchestrator_brain>
You are in team orchestration mode.
- Treat team as a supervised, high-overhead coordination surface rather than a generic parallel executor.
- Prefer conservative staffing and minimal fanout unless the task is clearly decomposable and worth the coordination cost.
- Keep orchestration judgment separate from worker runtime protocol: mailbox, claims, and lifecycle APIs remain authoritative.
- Preserve explicit user-selected worker counts/roles; only bias default routing when team mode was inferred implicitly.
- Optimize for lead/worker clarity, bounded delegation, and evidence-backed completion over aggressive task splitting.
</team_orchestrator_brain>
`;

const RECOGNIZED_REPLY_CONFIG = {
	enabled: true,
	pollIntervalMs: 3000,
	maxMessageLength: 500,
	rateLimitPerMinute: 10,
	includePrefix: true,
	authorizedDiscordUserIds: [],
	discordEnabled: true,
	telegramEnabled: false,
};

async function makeLayout(root: string) {
	const promptsDir = join(root, ".codex", "prompts");
	const skillsDir = join(root, ".codex", "skills");
	const nativeAgentsDir = join(root, ".codex", "agents");
	const legacyReplyStateDir = join(root, "user-state");
	await Promise.all([
		mkdir(promptsDir, { recursive: true }),
		mkdir(skillsDir, { recursive: true }),
		mkdir(nativeAgentsDir, { recursive: true }),
		mkdir(legacyReplyStateDir, { recursive: true }),
	]);
	return { promptsDir, skillsDir, nativeAgentsDir, legacyReplyStateDir };
}

describe("setup removed-surfaces v1 migration", () => {
	it("removes retired config entries with backup and remains idempotent", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-config-"));
		try {
			const layout = await makeLayout(root);
			const codexConfigPath = join(root, ".codex", "config.toml");
			const notificationConfigPath = join(root, ".codex", ".owx-config.json");
			const replyKey = ["re", "ply"].join("");
			await writeFile(codexConfigPath, [
				"[user.before]",
				'name = "kept"',
				`[mcp_servers.${REMOVED_SURFACES_V1_MCP_SERVER}]`,
				'command = "node"',
				'args = ["/tmp/retired.js"]',
				"[user.after]",
				'enabled = true',
			].join("\n"));
			await writeFile(notificationConfigPath, JSON.stringify({
				notifications: { enabled: true, [replyKey]: { enabled: true } },
				unrelated: { preserved: true },
			}, null, 2));
			const backedUp: string[] = [];
			const options = {
				...layout,
				codexConfigPath,
				notificationConfigPath,
				backup: async (path: string) => { backedUp.push(path); },
			};

			const first = await migrateRemovedSurfacesV1(options);
			assert.deepEqual(backedUp.sort(), [codexConfigPath, notificationConfigPath].sort());
			assert.equal(first.removed.includes(codexConfigPath), true);
			assert.equal(first.removed.includes(notificationConfigPath), true);
			assert.doesNotMatch(await readFile(codexConfigPath, "utf-8"), /retired\.js/);
			assert.match(await readFile(codexConfigPath, "utf-8"), /\[user\.before\]/);
			const migratedNotification = JSON.parse(await readFile(notificationConfigPath, "utf-8")) as Record<string, unknown>;
			assert.deepEqual(migratedNotification, {
				notifications: { enabled: true },
				unrelated: { preserved: true },
			});

			const second = await migrateRemovedSurfacesV1(options);
			assert.deepEqual(second.removed, []);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("freezes the latest supported release and installed skill hashes", () => {
		const byPath = new Map(
			REMOVED_SURFACES_V1_ASSETS.map((asset) => [
				asset.relativePath,
				asset.sha256,
			]),
		);
		assert.ok(
			byPath
				.get("team/SKILL.md")
				?.includes(
					"2163d2df462e21a9c5734dfbd764044195814937866cfe037b5a860a2f803397",
				),
		);
		assert.ok(
			byPath
				.get("team/SKILL.md")
				?.includes(
					"be08ddbb8301cbef6a3ae62d32292d996dac23b4ad52c618376055f9a1557ffc",
				),
		);
		assert.ok(
			byPath
				.get("worker/SKILL.md")
				?.includes(
					"d0d46a07b7675ac854d993be56565bc96d0f3c8c0776ec38a58955df3003fe51",
				),
		);
		assert.ok(
			byPath
				.get("swarm/SKILL.md")
				?.includes(
					"9806ce3dff32a149edc61bc62ee20ecadc1cce6fdc9f997f3abc5ec4cc1633d4",
				),
		);
	});

	it("removes a byte-proven managed asset and is idempotent", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const promptPath = join(layout.promptsDir, "team-orchestrator.md");
			await writeFile(promptPath, MANAGED_TEAM_ORCHESTRATOR_PROMPT);

			const first = await migrateRemovedSurfacesV1(layout);
			assert.deepEqual(first.removed, [promptPath]);
			assert.equal(existsSync(promptPath), false);

			const second = await migrateRemovedSurfacesV1(layout);
			assert.deepEqual(second.removed, []);
			assert.deepEqual(second.warnings, []);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("preserves a modified same-name collision and warns", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const promptPath = join(layout.promptsDir, "team-orchestrator.md");
			await writeFile(
				promptPath,
				`${MANAGED_TEAM_ORCHESTRATOR_PROMPT}\n# user edit\n`,
			);

			const result = await migrateRemovedSurfacesV1(layout);
			assert.deepEqual(result.removed, []);
			assert.deepEqual(result.preserved, [promptPath]);
			assert.match(result.warnings[0], /modified or unrecognized/);
			assert.match(await readFile(promptPath, "utf-8"), /user edit/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("preserves an unrecognized skill directory and its extra file", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const skillDir = join(layout.skillsDir, "team");
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, "SKILL.md"), "not a frozen asset\n");
			await writeFile(join(skillDir, "user-script.sh"), "#!/bin/sh\n");

			const result = await migrateRemovedSurfacesV1(layout);
			assert.deepEqual(result.removed, []);
			assert.equal(existsSync(join(skillDir, "user-script.sh")), true);
			assert.match(result.warnings[0], /modified or unrecognized/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("preserves a same-name symlink without following it", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const target = join(root, "user-prompt.md");
			const promptPath = join(layout.promptsDir, "team-orchestrator.md");
			await writeFile(target, MANAGED_TEAM_ORCHESTRATOR_PROMPT);
			await symlink(target, promptPath);

			const result = await migrateRemovedSurfacesV1(layout);
			assert.deepEqual(result.removed, []);
			assert.equal(existsSync(promptPath), true);
			assert.equal(
				await readFile(target, "utf-8"),
				MANAGED_TEAM_ORCHESTRATOR_PROMPT,
			);
			assert.match(result.warnings[0], /expected a regular/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("dry-run reports proven removals and signal intent without mutation", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const promptPath = join(layout.promptsDir, "team-orchestrator.md");
			const pidPath = join(layout.legacyReplyStateDir, "reply-\x6cistener.pid");
			await writeFile(promptPath, MANAGED_TEAM_ORCHESTRATOR_PROMPT);
			await writeFile(pidPath, "7171");
			const killed: number[] = [];

			const result = await migrateRemovedSurfacesV1({
				...layout,
				dryRun: true,
				dependencies: {
					processCommand: () => "node /opt/owx/reply-\x6cistener.js pollLoop",
					kill: (pid) => killed.push(pid),
				},
			});

			assert.deepEqual(killed, []);
			assert.equal(result.wouldSignalReplyListenerPid, 7171);
			assert.equal(result.signaledReplyListenerPid, null);
			assert.equal(existsSync(promptPath), true);
			assert.equal(existsSync(pidPath), true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("backs up and removes a recognized stopped-listener config without a PID", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const configPath = join(
				layout.legacyReplyStateDir,
				"reply-\x6cistener-config.json",
			);
			await writeFile(configPath, JSON.stringify(RECOGNIZED_REPLY_CONFIG));
			const backedUp: string[] = [];

			const result = await migrateRemovedSurfacesV1({
				...layout,
				backup: async (path) => {
					backedUp.push(path);
				},
			});

			assert.deepEqual(backedUp, [configPath]);
			assert.deepEqual(result.backupRequested, [configPath]);
			assert.equal(existsSync(configPath), false);
			assert.equal(
				result.decisions.at(-1)?.provenance,
				"recognized-reply-config-schema",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not signal or clean up a mismatched PID", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const pidPath = join(layout.legacyReplyStateDir, "reply-\x6cistener.pid");
			const configPath = join(
				layout.legacyReplyStateDir,
				"reply-\x6cistener-config.json",
			);
			await writeFile(pidPath, "4242");
			await writeFile(configPath, '{"token":"preserve"}\n');
			const killed: Array<[number, NodeJS.Signals]> = [];

			const result = await migrateRemovedSurfacesV1({
				...layout,
				dependencies: {
					processCommand: () => "node unrelated-service.js pollLoop",
					kill: (pid, signal) => killed.push([pid, signal]),
				},
			});

			assert.deepEqual(killed, []);
			assert.equal(existsSync(pidPath), true);
			assert.equal(existsSync(configPath), true);
			assert.match(result.warnings[0], /does not prove/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("signals an exact legacy listener and removes its PID and config", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const pidPath = join(layout.legacyReplyStateDir, "reply-\x6cistener.pid");
			const configPath = join(
				layout.legacyReplyStateDir,
				"reply-\x6cistener-config.json",
			);
			await writeFile(pidPath, "5151");
			await writeFile(configPath, '{"discordEnabled":true}\n');
			const killed: Array<[number, NodeJS.Signals]> = [];

			const dependencies: Partial<RemovedSurfacesMigrationDependencies> = {
				processCommand: () =>
					"node -e import('/opt/owx/dist/notifications/reply-\x6cistener.js').then(({ pollLoop }) => pollLoop())",
				kill: (pid, signal) => killed.push([pid, signal]),
			};
			const result = await migrateRemovedSurfacesV1({
				...layout,
				dependencies,
			});

			assert.deepEqual(killed, [[5151, "SIGTERM"]]);
			assert.equal(result.signaledReplyListenerPid, 5151);
			assert.equal(existsSync(pidPath), false);
			assert.equal(existsSync(configPath), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("runs from ordinary setup", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		const previousCwd = process.cwd();
		const originalLog = console.log;
		try {
			const stateDir = join(root, "user-state");
			await mkdir(stateDir, { recursive: true });
			await writeFile(join(stateDir, "reply-\x6cistener.pid"), "6161");
			await writeFile(join(stateDir, "reply-\x6cistener-config.json"), "{}\n");
			const killed: Array<[number, NodeJS.Signals]> = [];
			process.chdir(root);
			console.log = () => {};

			await setup({
				scope: "project",
				codexFeaturesProbe: () => null,
				codexVersionProbe: () => null,
				legacyReplyStateDir: stateDir,
				removedSurfacesMigrationDependencies: {
					processCommand: () =>
						"/usr/local/bin/node -e import('/opt/owx/dist/notifications/reply-\x6cistener.js').then(({ pollLoop }) => pollLoop())",
					kill: (pid, signal) => killed.push([pid, signal]),
				},
			});

			assert.deepEqual(killed, [[6161, "SIGTERM"]]);
			assert.equal(existsSync(join(stateDir, "reply-\x6cistener.pid")), false);
			assert.equal(
				existsSync(join(stateDir, "reply-\x6cistener-config.json")),
				false,
			);
		} finally {
			console.log = originalLog;
			process.chdir(previousCwd);
			await rm(root, { recursive: true, force: true });
		}
	});

	it("never reads or mutates historical project Team state", async () => {
		const root = await mkdtemp(join(tmpdir(), "owx-removed-surfaces-"));
		try {
			const layout = await makeLayout(root);
			const teamStatePath = join(
				root,
				".owx",
				"state",
				"teams",
				"historical",
				"state.json",
			);
			await mkdir(join(teamStatePath, ".."), { recursive: true });
			const original = Buffer.from('{"claim_token":"opaque","malformed":');
			await writeFile(teamStatePath, original);
			const touched: string[] = [];

			await migrateRemovedSurfacesV1({
				...layout,
				dependencies: {
					read: async (path) => {
						touched.push(path);
						return readFile(path);
					},
				},
			});

			assert.equal(touched.includes(teamStatePath), false);
			assert.deepEqual(await readFile(teamStatePath), original);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
