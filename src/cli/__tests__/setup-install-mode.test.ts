import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { setup } from "../setup.js";
import { uninstall } from "../uninstall.js";
import { OWX_FIRST_PARTY_MCP_SERVER_NAMES } from "../../config/owx-first-party-mcp.js";

const packageRoot = process.cwd();
let previousPathForFakeCodex: string | undefined;
let fakeCodexBinDir: string | null = null;
const CODEX_FEATURES_WITH_PLUGIN_SCOPED_HOOKS = [
	"hooks                                   stable             true",
	"plugin_hooks                            experimental       true",
	"goals                                   experimental       true",
	"",
].join("\n");

function pluginScopedHooksFeatureProbe(): string {
	return CODEX_FEATURES_WITH_PLUGIN_SCOPED_HOOKS;
}

before(async () => {
	previousPathForFakeCodex = process.env.PATH;
	fakeCodexBinDir = await mkdtemp(join(tmpdir(), "owx-fake-codex-"));
	const fakeCodexPath = join(fakeCodexBinDir, "codex");
	await writeFile(
		fakeCodexPath,
		[
			"#!/usr/bin/env node",
			"if (process.argv[2] === 'features' && process.argv[3] === 'list') {",
			"  console.log('hooks                                   stable             true');",
			"  console.log('plugin_hooks                            experimental       true');",
			"  console.log('goals                                   experimental       true');",
			"  process.exit(0);",
			"}",
			"if (process.argv.includes('--version') || process.argv[2] === '--version') {",
			"  console.log('codex-cli 0.999.0');",
			"  process.exit(0);",
			"}",
			"process.exit(0);",
			"",
		].join("\n"),
	);
	await chmod(fakeCodexPath, 0o755);
	process.env.PATH = `${fakeCodexBinDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`;
});

after(async () => {
	if (previousPathForFakeCodex === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = previousPathForFakeCodex;
	}
	if (fakeCodexBinDir !== null) {
		await rm(fakeCodexBinDir, { recursive: true, force: true });
	}
});

async function withTempCwd(wd: string, fn: () => Promise<void>): Promise<void> {
	const previousCwd = process.cwd();
	process.chdir(wd);
	try {
		await fn();
	} finally {
		process.chdir(previousCwd);
	}
}

async function runSetupWithCapturedLogs(
	wd: string,
	options: Parameters<typeof setup>[0],
): Promise<string> {
	const previousCwd = process.cwd();
	const originalLog = console.log;
	const logs: string[] = [];
	process.chdir(wd);
	console.log = (...args: unknown[]) => {
		logs.push(args.map((arg) => String(arg)).join(" "));
	};
	try {
		await setup(options);
		return logs.join("\n");
	} finally {
		console.log = originalLog;
		process.chdir(previousCwd);
	}
}

async function withIsolatedUserHome<T>(
	wd: string,
	fn: (codexHomeDir: string) => Promise<T>,
): Promise<T> {
	const previousHome = process.env.HOME;
	const previousCodexHome = process.env.CODEX_HOME;
	const homeDir = join(wd, "home");
	const codexHomeDir = join(homeDir, ".codex");
	await mkdir(codexHomeDir, { recursive: true });
	process.env.HOME = homeDir;
	process.env.CODEX_HOME = codexHomeDir;
	try {
		return await fn(codexHomeDir);
	} finally {
		if (typeof previousHome === "string") process.env.HOME = previousHome;
		else delete process.env.HOME;
		if (typeof previousCodexHome === "string") {
			process.env.CODEX_HOME = previousCodexHome;
		} else {
			delete process.env.CODEX_HOME;
		}
	}
}

describe("notify setup scope", () => {
	it("does not write unsupported project-scope notify", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-project-no-notify-"));
		try {
			await withTempCwd(wd, async () => {
				await setup({ scope: "project" });
			});
			const config = await readFile(join(wd, ".codex", "config.toml"), "utf-8");
			assert.doesNotMatch(config, /^notify\s*=/m);
			assert.doesNotMatch(config, /notify-hook\.js/);
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("preserves existing user project-scope notify while suppressing OWX notify", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-project-user-notify-"));
		try {
			await mkdir(join(wd, ".codex"), { recursive: true });
			await writeFile(
				join(wd, ".codex", "config.toml"),
				'notify = ["node", "/tmp/notify-hook.js"]\napproval_policy = "never"\n',
			);
			await withTempCwd(wd, async () => {
				await setup({ scope: "project" });
			});
			const config = await readFile(join(wd, ".codex", "config.toml"), "utf-8");
			assert.match(config, /^notify = \["node", "\/tmp\/notify-hook\.js"\]$/m);
			assert.doesNotMatch(config, /owen-codex.*notify-hook\.js/);
			assert.match(config, /^approval_policy = "never"$/m);
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("wraps and restores an existing user notify", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-user-notify-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await mkdir(codexHomeDir, { recursive: true });
				await writeFile(
					join(codexHomeDir, "config.toml"),
					'notify = ["node", "/tmp/user-notify.js"]\napproval_policy = "on-failure"\n',
				);
				await withTempCwd(wd, async () => {
					await setup({ scope: "user" });
				});

				const config = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(
					config,
					/^notify = \["node", ".*notify-dispatcher\.js", "--metadata", ".*notify-dispatch\.json"\]$/m,
				);
				const metadataPath = join(codexHomeDir, ".owx", "notify-dispatch.json");
				const metadata = JSON.parse(await readFile(metadataPath, "utf-8"));
				assert.deepEqual(metadata.previousNotify, [
					"node",
					"/tmp/user-notify.js",
				]);
				assert.deepEqual(metadata.owxNotify?.slice(0, 1), ["node"]);

				await withTempCwd(wd, async () => {
					await setup({ scope: "user" });
				});
				const rerunConfig = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(rerunConfig, /notify-dispatcher\.js/);
				const rerunMetadata = JSON.parse(await readFile(metadataPath, "utf-8"));
				assert.deepEqual(rerunMetadata.previousNotify, [
					"node",
					"/tmp/user-notify.js",
				]);

				await withTempCwd(wd, async () => {
					await uninstall({ scope: "user" });
				});
				const restored = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(
					restored,
					new RegExp('^notify = \\["node", "/tmp/user-notify\\.js"\\]$', "m"),
				);
				assert.doesNotMatch(restored, /notify-dispatcher\.js/);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("does not preserve stale OWX dispatcher metadata as previous notify", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-stale-dispatcher-notify-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await mkdir(codexHomeDir, { recursive: true });
				const metadataPath = join(codexHomeDir, ".owx", "notify-dispatch.json");
				const stalePkgRoot = join(wd, "old-global", "owen-codex");
				const staleDispatcher = join(
					stalePkgRoot,
					"dist",
					"scripts",
					"notify-dispatcher.js",
				);
				await mkdir(dirname(metadataPath), { recursive: true });
				await writeFile(
					join(codexHomeDir, "config.toml"),
					`notify = ["node", "${staleDispatcher}", "--metadata", "${metadataPath}"]\napproval_policy = "on-failure"\n`,
				);
				await writeFile(
					metadataPath,
					JSON.stringify({
						managedBy: "owen-codex",
						version: 1,
						previousNotify: [
							"node",
							staleDispatcher,
							"--metadata",
							metadataPath,
						],
						owxNotify: [
							"node",
							join(stalePkgRoot, "dist", "scripts", "notify-hook.js"),
						],
						dispatcherNotify: [
							"node",
							staleDispatcher,
							"--metadata",
							metadataPath,
						],
					}),
				);

				await withTempCwd(wd, async () => {
					await setup({ scope: "user" });
				});

				const config = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(config, /^notify = \["node", ".*notify-hook\.js"\]$/m);
				assert.doesNotMatch(config, /notify-dispatcher\.js/);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("does not preserve nested encoded stale turn-ended previous notify metadata", async () => {
		const wd = await mkdtemp(
			join(tmpdir(), "owx-stale-nested-wrapper-notify-"),
		);
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await mkdir(codexHomeDir, { recursive: true });
				const metadataPath = join(codexHomeDir, ".owx", "notify-dispatch.json");
				const stalePkgRoot = join(wd, "old-global", "owen-codex");
				const staleDispatcher = join(
					stalePkgRoot,
					"dist",
					"scripts",
					"notify-dispatcher.js",
				);
				const staleTurnEndedWrapper = join(wd, "SkyComputerUseClient");
				await mkdir(dirname(metadataPath), { recursive: true });
				await writeFile(
					join(codexHomeDir, "config.toml"),
					`notify = ["node", "${staleDispatcher}", "--metadata", "${metadataPath}"]\napproval_policy = "on-failure"\n`,
				);
				const nestedWrapper = JSON.stringify([
					"node",
					staleTurnEndedWrapper,
					"turn-ended",
					"--previous-notify",
					JSON.stringify(["node", staleDispatcher, "--metadata", metadataPath]),
				]);
				await writeFile(
					metadataPath,
					JSON.stringify({
						managedBy: "owen-codex",
						version: 1,
						previousNotify: [
							"node",
							staleTurnEndedWrapper,
							"turn-ended",
							"--previous-notify",
							JSON.stringify(nestedWrapper),
						],
						owxNotify: [
							"node",
							join(stalePkgRoot, "dist", "scripts", "notify-hook.js"),
						],
						dispatcherNotify: [
							"node",
							staleDispatcher,
							"--metadata",
							metadataPath,
						],
					}),
				);

				await withTempCwd(wd, async () => {
					await setup({ scope: "user" });
				});

				const config = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(config, /^notify = \["node", ".*notify-hook\.js"\]$/m);
				assert.doesNotMatch(config, /notify-dispatcher\.js/);
				assert.doesNotMatch(config, /SkyComputerUseClient/);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("does not preserve stale turn-ended wrappers with OWX previous notify metadata", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-stale-wrapper-notify-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await mkdir(codexHomeDir, { recursive: true });
				const metadataPath = join(codexHomeDir, ".owx", "notify-dispatch.json");
				const stalePkgRoot = join(wd, "old-global", "owen-codex");
				const staleDispatcher = join(
					stalePkgRoot,
					"dist",
					"scripts",
					"notify-dispatcher.js",
				);
				const staleTurnEndedWrapper = join(wd, "SkyComputerUseClient");
				await mkdir(dirname(metadataPath), { recursive: true });
				await writeFile(
					join(codexHomeDir, "config.toml"),
					`notify = ["node", "${staleDispatcher}", "--metadata", "${metadataPath}"]\napproval_policy = "on-failure"\n`,
				);
				await writeFile(
					metadataPath,
					JSON.stringify({
						managedBy: "owen-codex",
						version: 1,
						previousNotify: [
							"node",
							staleTurnEndedWrapper,
							"turn-ended",
							"--previous-notify",
							JSON.stringify([
								"node",
								staleDispatcher,
								"--metadata",
								metadataPath,
							]),
						],
						owxNotify: [
							"node",
							join(stalePkgRoot, "dist", "scripts", "notify-hook.js"),
						],
						dispatcherNotify: [
							"node",
							staleDispatcher,
							"--metadata",
							metadataPath,
						],
					}),
				);

				await withTempCwd(wd, async () => {
					await setup({ scope: "user" });
				});

				const config = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(config, /^notify = \["node", ".*notify-hook\.js"\]$/m);
				assert.doesNotMatch(config, /notify-dispatcher\.js/);
				assert.doesNotMatch(config, /SkyComputerUseClient/);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("repairs reporter-shaped SkyComputerUseClient dispatcher metadata on rerun", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-reporter-wrapper-notify-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await mkdir(codexHomeDir, { recursive: true });
				const metadataPath = join(codexHomeDir, ".owx", "notify-dispatch.json");
				const stalePkgRoot = join(wd, "pkg-without-managed-name");
				const staleDispatcher = join(
					stalePkgRoot,
					"dist",
					"scripts",
					"notify-dispatcher.js",
				);
				const staleTurnEndedWrapper = join(wd, "SkyComputerUseClient");
				await mkdir(dirname(metadataPath), { recursive: true });
				await writeFile(
					join(codexHomeDir, "config.toml"),
					`notify = ["node", "${staleDispatcher}", "--metadata", "${metadataPath}"]
approval_policy = "on-failure"
`,
				);
				await writeFile(
					metadataPath,
					JSON.stringify({
						managedBy: "owen-codex",
						version: 1,
						previousNotify: [
							staleTurnEndedWrapper,
							"turn-ended",
							"--previous-notify",
							JSON.stringify([
								"node",
								staleDispatcher,
								"--metadata",
								metadataPath,
							]),
						],
						owxNotify: [
							"node",
							join(stalePkgRoot, "dist", "scripts", "notify-hook.js"),
						],
						dispatcherNotify: [
							"node",
							staleDispatcher,
							"--metadata",
							metadataPath,
						],
					}),
				);

				await withTempCwd(wd, async () => {
					await setup({ scope: "user" });
				});

				const config = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(config, /^notify = \["node", ".*notify-hook\.js"\]$/m);
				assert.doesNotMatch(config, /notify-dispatcher\.js/);
				assert.doesNotMatch(config, /SkyComputerUseClient/);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("does not wrap stale global OWX notify hooks as user notify commands", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-stale-hook-notify-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await mkdir(codexHomeDir, { recursive: true });
				const staleHook = join(
					"/opt",
					"homebrew",
					"lib",
					"node_modules",
					"owen-codex",
					"dist",
					"scripts",
					"notify-hook.js",
				);
				await writeFile(
					join(codexHomeDir, "config.toml"),
					`notify = ["node", "${staleHook}"]\napproval_policy = "on-failure"\n`,
				);

				await withTempCwd(wd, async () => {
					await setup({ scope: "user" });
				});

				const config = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(config, /^notify = \["node", ".*notify-hook\.js"\]$/m);
				assert.doesNotMatch(config, /notify-dispatcher\.js/);
				assert.doesNotMatch(
					config,
					/lib\/node_modules\/owen-codex\/dist\/scripts\/notify-hook\.js/,
				);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});
});

async function assertProjectPluginModeArtifacts(wd: string): Promise<void> {
	assert.equal(existsSync(join(wd, ".codex", "hooks.json")), false);
	const config = await readFile(join(wd, ".codex", "config.toml"), "utf-8");
	assert.match(config, /^plugin_hooks = true$/m);
	assert.doesNotMatch(config, /^hooks = true$/m);
	assert.match(config, /^goals = true$/m);
	assert.doesNotMatch(config, /developer_instructions|notify-hook/g);
	assert.equal(
		existsSync(join(wd, ".codex", "skills", "ask", "SKILL.md")),
		false,
	);
	assert.equal(existsSync(join(wd, ".codex", "agents", "planner.toml")), true);
	assert.equal(existsSync(join(wd, ".codex", "prompts", "executor.md")), false);
	assert.equal(existsSync(join(wd, "AGENTS.md")), false);

	const persisted = JSON.parse(
		await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
	) as { scope: string; installMode?: string };
	assert.deepEqual(persisted, {
		scope: "project",
		installMode: "plugin",
		mcpMode: "none",
	});
}

async function captureConsoleOutput(fn: () => Promise<void>): Promise<string> {
	const originalLog = console.log;
	const originalWarn = console.warn;
	const lines: string[] = [];
	console.log = (...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	};
	console.warn = (...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	};
	try {
		await fn();
	} finally {
		console.log = originalLog;
		console.warn = originalWarn;
	}
	return lines.join("\n");
}

async function seedPluginCacheFromInstalledSkills(
	codexHomeDir: string,
): Promise<void> {
	const artifactPath = join(
		codexHomeDir,
		"plugins",
		"cache",
		"local-marketplace",
		"owen-codex",
		"local",
	);
	await mkdir(join(artifactPath, ".codex-plugin"), { recursive: true });
	await writeFile(
		join(artifactPath, ".codex-plugin", "plugin.json"),
		JSON.stringify({ name: "owen-codex", version: "local" }),
	);
	const manifest = JSON.parse(
		await readFile(
			join(packageRoot, "src", "catalog", "manifest.json"),
			"utf-8",
		),
	) as { skills: Array<{ name: string; status?: string }> };
	const installableSkillNames = new Set([
		...manifest.skills
			.filter(
				(skill) => skill.status === "active" || skill.status === "internal",
			)
			.map((skill) => skill.name),
		"wiki",
	]);
	await mkdir(join(artifactPath, "skills"), { recursive: true });
	await Promise.all(
		[...installableSkillNames].map((skillName) =>
			cp(
				join(codexHomeDir, "skills", skillName),
				join(artifactPath, "skills", skillName),
				{
					recursive: true,
				},
			),
		),
	);
}

async function seedStalePluginDiscoveryCache(
	codexHomeDir: string,
): Promise<string> {
	const artifactPath = join(
		codexHomeDir,
		"plugins",
		"cache",
		"owen-codex-local",
		"owen-codex",
	);
	await mkdir(join(artifactPath, ".codex-plugin"), { recursive: true });
	await writeFile(
		join(artifactPath, ".codex-plugin", "plugin.json"),
		JSON.stringify(
			{ name: "owen-codex", version: "0.0.0", skills: "./skills/" },
			null,
			2,
		),
	);
	await mkdir(join(artifactPath, "skills", "old-only"), { recursive: true });
	await writeFile(
		join(artifactPath, "skills", "old-only", "SKILL.md"),
		"# old\n",
	);
	return artifactPath;
}

async function seedSameVersionPluginCacheWithStaleHooks(
	codexHomeDir: string,
): Promise<string> {
	const cacheDir = await packagedPluginCacheDir(codexHomeDir);
	await mkdir(dirname(cacheDir), { recursive: true });
	await cp(join(packageRoot, "plugins", "owen-codex"), cacheDir, {
		recursive: true,
	});
	const hooksPath = join(cacheDir, "hooks", "hooks.json");
	const hooks = JSON.parse(await readFile(hooksPath, "utf-8")) as {
		hooks?: { PreToolUse?: Array<Record<string, unknown>> };
	};
	const preToolUse = hooks.hooks?.PreToolUse?.[0];
	assert.ok(preToolUse, "expected packaged plugin PreToolUse hook fixture");
	preToolUse.matcher = "Bash";
	await writeFile(hooksPath, JSON.stringify(hooks, null, 2) + "\n");
	return cacheDir;
}

async function seedSameVersionPluginCacheWithStaleLauncher(
	codexHomeDir: string,
): Promise<string> {
	const cacheDir = await packagedPluginCacheDir(codexHomeDir);
	await mkdir(dirname(cacheDir), { recursive: true });
	await cp(join(packageRoot, "plugins", "owen-codex"), cacheDir, {
		recursive: true,
	});
	await writeFile(
		join(cacheDir, "hooks", "codex-native-hook.mjs"),
		"// stale standalone hook\n",
	);
	return cacheDir;
}

async function packagedPluginCacheDir(codexHomeDir: string): Promise<string> {
	const manifest = JSON.parse(
		await readFile(
			join(
				packageRoot,
				"plugins",
				"owen-codex",
				".codex-plugin",
				"plugin.json",
			),
			"utf-8",
		),
	) as { version: string };
	return join(
		codexHomeDir,
		"plugins",
		"cache",
		"owen-codex-local",
		"owen-codex",
		manifest.version,
	);
}

describe("owx setup install mode behavior", () => {
	it("summarizes and keeps persisted setup preferences when review chooses keep", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await mkdir(join(wd, ".owx"), { recursive: true });
					await writeFile(
						join(wd, ".owx", "setup-scope.json"),
						JSON.stringify({ scope: "user", installMode: "legacy" }),
					);

					const output = await captureConsoleOutput(async () => {
						await setup({
							persistedSetupReviewPrompt: async (preferences) => {
								assert.deepEqual(preferences, {
									scope: "user",
									installMode: "legacy",
								});
								return "keep";
							},
						});
					});

					assert.match(
						output,
						/Setup preference review: keep \(scope=user, installMode=legacy, mcpMode=not recorded\)/,
					);
					assert.match(
						output,
						/Using setup scope: user \(from \.owx\/setup-scope\.json\)/,
					);
					assert.match(
						output,
						/Using setup install mode: legacy \(from \.owx\/setup-scope\.json\)/,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("uses persisted choices as defaults when review changes setup preferences", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await mkdir(join(wd, ".owx"), { recursive: true });
					await writeFile(
						join(wd, ".owx", "setup-scope.json"),
						JSON.stringify({ scope: "user", installMode: "legacy" }),
					);

					await setup({
						persistedSetupReviewPrompt: async () => "review",
						setupScopePrompt: async (defaultScope) => {
							assert.equal(defaultScope, "user");
							return "user";
						},
						installModePrompt: async (defaultMode) => {
							assert.equal(defaultMode, "legacy");
							return "plugin";
						},
					});

					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, {
						scope: "user",
						installMode: "plugin",
						mcpMode: "none",
					});
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("clears user-scope install mode when review switches setup to project scope", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await mkdir(join(wd, ".owx"), { recursive: true });
					await writeFile(
						join(wd, ".owx", "setup-scope.json"),
						JSON.stringify({ scope: "user", installMode: "plugin" }),
					);

					await setup({
						persistedSetupReviewPrompt: async () => "review",
						setupScopePrompt: async (defaultScope) => {
							assert.equal(defaultScope, "user");
							return "project";
						},
					});

					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, { scope: "project", mcpMode: "none" });
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("reviews persisted scope when only install mode is provided", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await mkdir(join(wd, ".owx"), { recursive: true });
					await writeFile(
						join(wd, ".owx", "setup-scope.json"),
						JSON.stringify({ scope: "project" }),
					);

					let reviewed = false;
					await setup({
						installMode: "plugin",
						persistedSetupReviewPrompt: async () => {
							reviewed = true;
							return "reset";
						},
						setupScopePrompt: async (defaultScope) => {
							assert.equal(defaultScope, "user");
							return "user";
						},
					});

					assert.equal(reviewed, true);
					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, {
						scope: "user",
						installMode: "plugin",
						mcpMode: "none",
					});
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("reviews persisted install mode when only user scope is provided", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await mkdir(join(wd, ".owx"), { recursive: true });
					await writeFile(
						join(wd, ".owx", "setup-scope.json"),
						JSON.stringify({ scope: "user", installMode: "legacy" }),
					);

					let reviewed = false;
					await setup({
						scope: "user",
						persistedSetupReviewPrompt: async () => {
							reviewed = true;
							return "review";
						},
						installModePrompt: async (defaultMode) => {
							assert.equal(defaultMode, "legacy");
							return "plugin";
						},
					});

					assert.equal(reviewed, true);
					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, {
						scope: "user",
						installMode: "plugin",
						mcpMode: "none",
					});
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("ignores persisted setup preferences when review chooses reset", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await mkdir(join(wd, ".owx"), { recursive: true });
					await writeFile(
						join(wd, ".owx", "setup-scope.json"),
						JSON.stringify({ scope: "project", installMode: "plugin" }),
					);

					await setup({
						persistedSetupReviewPrompt: async () => "reset",
						setupScopePrompt: async (defaultScope) => {
							assert.equal(defaultScope, "user");
							return "user";
						},
						installModePrompt: async (defaultMode) => {
							assert.equal(defaultMode, "legacy");
							return "legacy";
						},
					});

					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, {
						scope: "user",
						installMode: "legacy",
						mcpMode: "none",
					});
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("installs native agent TOML files in plugin mode so agent_type roles are available", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				const output = await runSetupWithCapturedLogs(wd, {
					scope: "user",
					installMode: "plugin",
				});

				assert.match(output, /Next steps:/);
				assert.match(
					output,
					/Registered Codex marketplace owen-codex-local supplies OWX skills and workflow surfaces/,
				);
				assert.match(
					output,
					/Native agent role TOML files written to \.codex\/agents\//,
				);

				for (const role of ["architect", "critic", "scholastic"]) {
					const tomlPath = join(codexHomeDir, "agents", `${role}.toml`);
					assert.equal(existsSync(tomlPath), true, `${role}.toml should exist`);
					const toml = await readFile(tomlPath, "utf-8");
					assert.match(toml, new RegExp(`^name = "${role}"$`, "m"));
				}
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("materializes only current plugin skills and native agent roles", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-no-team-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "plugin",
					});
				});

				const pkg = JSON.parse(
					await readFile(join(packageRoot, "package.json"), "utf-8"),
				) as { version: string };
				const cacheSkillsDir = join(
					codexHomeDir,
					"plugins",
					"cache",
					"owen-codex-local",
					"owen-codex",
					pkg.version,
					"skills",
				);
				assert.equal(
					existsSync(join(cacheSkillsDir, "team", "SKILL.md")),
					false,
				);
				assert.equal(
					existsSync(join(cacheSkillsDir, "worker", "SKILL.md")),
					false,
				);
				assert.equal(
					existsSync(join(cacheSkillsDir, "ralph", "SKILL.md")),
					true,
				);
				assert.equal(
					existsSync(join(codexHomeDir, "agents", "te\x61m-executor.toml")),
					false,
				);
				assert.equal(
					existsSync(join(codexHomeDir, "agents", "executor.toml")),
					true,
				);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("keeps legacy-mode next steps describing native agent TOML output", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				const output = await runSetupWithCapturedLogs(wd, {
					scope: "user",
					installMode: "legacy",
				});

				assert.match(output, /Next steps:/);
				assert.match(
					output,
					/Native agent defaults configured in config\.toml \[agents\] and TOML files written to \.codex\/agents\//,
				);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("persists user install mode choices alongside setup scope", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "plugin" });
				});
			});

			const persisted = JSON.parse(
				await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
			) as { scope: string; installMode?: string; mcpMode?: string };
			assert.deepEqual(persisted, {
				scope: "user",
				installMode: "plugin",
				mcpMode: "none",
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("defaults setup to no first-party MCP blocks", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-mcp-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "legacy" });
				});
				const config = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.doesNotMatch(config, /^\[mcp_servers\.owx_state\]$/m);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("emits first-party MCP blocks when compat MCP mode is requested", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-mcp-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "legacy",
						mcpMode: "compat",
					});
				});
				const config = await readFile(
					join(codexHomeDir, "config.toml"),
					"utf-8",
				);
				assert.match(config, /^\[mcp_servers\.owx_state\]$/m);
				const persisted = JSON.parse(
					await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
				) as { mcpMode?: string };
				assert.equal(persisted.mcpMode, "compat");
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("warns and preserves existing first-party MCP registrations in non-interactive default setup", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-mcp-preserve-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				const configPath = join(codexHomeDir, "config.toml");
				await writeFile(
					configPath,
					[
						"[mcp_servers.owx_state]",
						'command = "node"',
						'args = ["/tmp/state-server.js"]',
						"",
						"[mcp_servers.user_tool]",
						'command = "user-tool"',
						"",
					].join("\n"),
				);
				const output = await runSetupWithCapturedLogs(wd, {
					scope: "user",
					installMode: "legacy",
				});
				const config = await readFile(configPath, "utf-8");
				assert.match(
					output,
					/deprecated first-party OWX MCP registrations were detected but preserved/,
				);
				assert.match(config, /^\[mcp_servers\.owx_state\]$/m);
				assert.match(config, /^\[mcp_servers\.user_tool\]$/m);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("removes existing first-party MCP registrations only when the interactive migration prompt is accepted", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-mcp-remove-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				const configPath = join(codexHomeDir, "config.toml");
				await writeFile(
					configPath,
					[
						"[mcp_servers.owx_state]",
						'command = "node"',
						'args = ["/tmp/state-server.js"]',
						"",
						"[mcp_servers.owx_team_run]",
						'command = "node"',
						"",
						"[mcp_servers.user_tool]",
						'command = "user-tool"',
						"",
					].join("\n"),
				);
				const output = await runSetupWithCapturedLogs(wd, {
					scope: "user",
					installMode: "legacy",
					firstPartyMcpRemovalPrompt: async (_path, kinds) => {
						assert.deepEqual(kinds, ["config.toml [mcp_servers.owx_*]"]);
						return true;
					},
				});
				const config = await readFile(configPath, "utf-8");
				assert.match(
					output,
					/Deprecated first-party OWX MCP registrations will be removed/,
				);
				assert.doesNotMatch(config, /^\[mcp_servers\.owx_state\]$/m);
				assert.doesNotMatch(config, /^\[mcp_servers\.owx_team_run\]$/m);
				assert.match(config, /^\[mcp_servers\.user_tool\]$/m);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("preserves existing first-party MCP registrations when the interactive migration prompt is declined", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-mcp-decline-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				const configPath = join(codexHomeDir, "config.toml");
				await writeFile(
					configPath,
					'[mcp_servers.owx_memory]\ncommand = "node"\n\n[mcp_servers.user_tool]\ncommand = "user-tool"\n',
				);
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "legacy",
						firstPartyMcpRemovalPrompt: async () => false,
					});
				});
				const config = await readFile(configPath, "utf-8");
				assert.match(config, /^\[mcp_servers\.owx_memory\]$/m);
				assert.match(config, /^\[mcp_servers\.user_tool\]$/m);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("defaults to plugin mode when an installed owen-codex plugin cache is discovered", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const pluginDir = join(
						codexHomeDir,
						"plugins",
						"cache",
						"owen-codex-local",
						"owen-codex",
					);
					await mkdir(join(pluginDir, ".codex-plugin"), { recursive: true });
					await writeFile(
						join(pluginDir, ".codex-plugin", "plugin.json"),
						JSON.stringify({ name: "owen-codex", version: "local" }),
					);

					await setup({ scope: "user" });

					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, {
						scope: "user",
						installMode: "plugin",
						mcpMode: "none",
					});
					assert.equal(
						existsSync(join(codexHomeDir, "skills", "ask", "SKILL.md")),
						false,
					);
					assert.equal(existsSync(join(codexHomeDir, "hooks.json")), false);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("invalidates stale plugin discovery caches so updated plugin skills refresh", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const cacheDir = await seedStalePluginDiscoveryCache(codexHomeDir);

					const output = await captureConsoleOutput(async () => {
						await setup({
							scope: "user",
							installMode: "plugin",
							codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						});
					});

					assert.equal(
						existsSync(join(cacheDir, "skills", "old-only", "SKILL.md")),
						false,
					);
					assert.equal(
						existsSync(
							join(
								await packagedPluginCacheDir(codexHomeDir),
								"skills",
								"ask",
								"SKILL.md",
							),
						),
						true,
					);
					assert.match(
						output,
						/Invalidated 1 stale Codex plugin discovery cache entry/,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "skills", "old-only", "SKILL.md")),
						false,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("invalidates same-version plugin caches when hook file contents drift", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const cacheDir =
						await seedSameVersionPluginCacheWithStaleHooks(codexHomeDir);

					const output = await captureConsoleOutput(async () => {
						await setup({
							scope: "user",
							installMode: "plugin",
							codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						});
					});

					const refreshedHooks = JSON.parse(
						await readFile(join(cacheDir, "hooks", "hooks.json"), "utf-8"),
					) as { hooks?: { PreToolUse?: Array<{ matcher?: unknown }> } };
					assert.equal(
						refreshedHooks.hooks?.PreToolUse?.[0]?.matcher,
						undefined,
					);
					assert.match(
						output,
						/Invalidated 1 stale Codex plugin discovery cache entry/,
					);
					assert.match(output, /Installed local Codex plugin cache/);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("invalidates same-version plugin caches when the standalone hook drifts", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const cacheDir =
						await seedSameVersionPluginCacheWithStaleLauncher(codexHomeDir);

					const output = await captureConsoleOutput(async () => {
						await setup({
							scope: "user",
							installMode: "plugin",
							codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						});
					});

					const standaloneHook = await readFile(
						join(cacheDir, "hooks", "codex-native-hook.mjs"),
						"utf-8",
					);
					assert.match(standaloneHook, /owx-plugin-hook-standalone:v1/);
					assert.match(
						output,
						/Invalidated 1 stale Codex plugin discovery cache entry/,
					);
					assert.match(output, /Installed local Codex plugin cache/);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("reports stale plugin discovery cache invalidation during dry-run without deleting it", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const cacheDir = await seedStalePluginDiscoveryCache(codexHomeDir);

					const output = await captureConsoleOutput(async () => {
						await setup({ scope: "user", installMode: "plugin", dryRun: true });
					});

					assert.equal(existsSync(cacheDir), true);
					assert.match(
						output,
						/Would invalidate 1 stale Codex plugin discovery cache entry/,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("reports plugin cache materialization during dry-run without writing cache", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const output = await captureConsoleOutput(async () => {
						await setup({ scope: "user", installMode: "plugin", dryRun: true });
					});

					const cacheDir = await packagedPluginCacheDir(codexHomeDir);
					assert.equal(existsSync(cacheDir), false);
					assert.match(output, /Would install local Codex plugin cache/);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("does not prompt for install mode during project-scoped setup", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		let promptCalls = 0;
		try {
			await withTempCwd(wd, async () => {
				await setup({
					scope: "project",
					installModePrompt: async () => {
						promptCalls += 1;
						return "plugin";
					},
				});
			});

			assert.equal(promptCalls, 0);
			const persisted = JSON.parse(
				await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
			) as { scope: string; installMode?: string };
			assert.deepEqual(persisted, { scope: "project", mcpMode: "none" });
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("does not reuse stale user install mode for project-scoped setup", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "plugin" });

					await setup({ scope: "project" });

					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, { scope: "project", mcpMode: "none" });
					assert.equal(
						existsSync(join(wd, ".codex", "skills", "ask", "SKILL.md")),
						true,
					);

					await setup({ scope: "project" });

					const repeatedPersisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(repeatedPersisted, {
						scope: "project",
						mcpMode: "none",
					});
					assert.equal(
						existsSync(join(wd, ".codex", "agents", "planner.toml")),
						true,
					);
					assert.equal(
						existsSync(join(wd, ".codex", "prompts", "executor.md")),
						true,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("does not reuse stale project install mode for user-scoped setup", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({
						scope: "project",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
					});

					await setup({ scope: "user" });

					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, {
						scope: "user",
						installMode: "legacy",
						mcpMode: "none",
					});
					assert.equal(
						existsSync(join(codexHomeDir, "skills", "ask", "SKILL.md")),
						true,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "agents", "planner.toml")),
						true,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "prompts", "executor.md")),
						true,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("registers the local Codex plugin marketplace without reintroducing legacy assets", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const configPath = join(codexHomeDir, "config.toml");
					await writeFile(
						configPath,
						[
							'model = "gpt-5.5"',
							"",
							"[marketplaces.other]",
							'source_type = "local"',
							'source = "/tmp/other"',
							"",
							"[marketplaces.owen-codex-local]",
							'source_type = "local"',
							'source = "/tmp/stale-owen-codex"',
							"",
						].join("\n"),
					);

					await setup({
						scope: "user",
						installMode: "plugin",
						force: true,
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
					});
					await setup({
						scope: "user",
						installMode: "plugin",
						force: true,
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
					});

					const config = await readFile(configPath, "utf-8");
					const parsed = parseToml(config) as {
						marketplaces?: Record<
							string,
							{ source_type?: string; source?: string }
						>;
						plugins?: Record<string, { enabled?: boolean }>;
					};
					assert.equal(
						parsed.marketplaces?.["owen-codex-local"]?.source_type,
						"local",
					);
					assert.equal(
						parsed.marketplaces?.["owen-codex-local"]?.source,
						packageRoot,
					);
					assert.equal(parsed.marketplaces?.other?.source_type, "local");
					assert.equal(parsed.marketplaces?.other?.source, "/tmp/other");
					assert.equal(
						(config.match(/^\[marketplaces\.owen-codex-local\]$/gm) ?? [])
							.length,
						1,
					);
					assert.equal(
						(
							config.match(/^\[plugins\."owen-codex@owen-codex-local"\]$/gm) ??
							[]
						).length,
						1,
					);
					assert.equal(
						parsed.plugins?.["owen-codex@owen-codex-local"]?.enabled,
						true,
					);
					const cacheDir = await packagedPluginCacheDir(codexHomeDir);
					assert.equal(
						existsSync(join(cacheDir, ".codex-plugin", "plugin.json")),
						true,
					);
					assert.equal(
						existsSync(join(cacheDir, "skills", "ask", "SKILL.md")),
						true,
					);
					assert.match(config, /^plugin_hooks = true$/m);
					assert.doesNotMatch(config, /^hooks = true$/m);
					assert.doesNotMatch(config, /^codex_hooks = true$/m);
					assert.doesNotMatch(config, /\[mcp_servers\./);
					assert.equal(
						existsSync(join(codexHomeDir, "skills", "ask", "SKILL.md")),
						false,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "agents", "planner.toml")),
						true,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "prompts", "executor.md")),
						false,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("enables the local Codex plugin while preserving plugin subtable policy", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const configPath = join(codexHomeDir, "config.toml");
					await writeFile(
						configPath,
						[
							'[plugins."owen-codex@owen-codex-local"]',
							"enabled = false",
							"",
							'[plugins."owen-codex@owen-codex-local".mcp_servers.owx_state]',
							"enabled = false",
							"",
						].join("\n"),
					);

					await setup({ scope: "user", installMode: "plugin", force: true });
					await setup({ scope: "user", installMode: "plugin", force: true });

					const config = await readFile(configPath, "utf-8");
					const parsed = parseToml(config) as {
						plugins?: Record<
							string,
							{
								enabled?: boolean;
								mcp_servers?: Record<string, { enabled?: boolean }>;
							}
						>;
					};

					assert.equal(
						(
							config.match(/^\[plugins\."owen-codex@owen-codex-local"\]$/gm) ??
							[]
						).length,
						1,
					);
					assert.equal(
						parsed.plugins?.["owen-codex@owen-codex-local"]?.enabled,
						true,
					);
					assert.equal(
						parsed.plugins?.["owen-codex@owen-codex-local"]?.mcp_servers
							?.owx_state?.enabled,
						false,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("registers plugin MCP subtables only when compat MCP mode is requested", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const configPath = join(codexHomeDir, "config.toml");

					await setup({
						scope: "user",
						installMode: "plugin",
						mcpMode: "compat",
						force: true,
					});
					let parsed = parseToml(await readFile(configPath, "utf-8")) as {
						plugins?: Record<
							string,
							{ mcp_servers?: Record<string, { enabled?: boolean }> }
						>;
					};
					assert.equal(
						parsed.plugins?.["owen-codex@owen-codex-local"]?.mcp_servers
							?.owx_state?.enabled,
						true,
					);

					await setup({
						scope: "user",
						installMode: "plugin",
						mcpMode: "none",
						force: true,
					});
					parsed = parseToml(await readFile(configPath, "utf-8")) as {
						plugins?: Record<
							string,
							{ mcp_servers?: Record<string, { enabled?: boolean }> }
						>;
					};
					assert.equal(
						parsed.plugins?.["owen-codex@owen-codex-local"]?.mcp_servers
							?.owx_state?.enabled,
						true,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("removes plugin MCP registrations only when the migration prompt is accepted", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-plugin-mcp-remove-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				const configPath = join(codexHomeDir, "config.toml");
				await writeFile(
					configPath,
					[
						"[mcp_servers.owx_state]",
						'command = "node"',
						"",
						'[plugins."owen-codex@owen-codex-local"]',
						"enabled = true",
						"",
						'[plugins."owen-codex@owen-codex-local".mcp_servers.owx_memory]',
						"enabled = true",
						"",
					].join("\n"),
				);
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "plugin",
						firstPartyMcpRemovalPrompt: async (_path, kinds) => {
							assert.deepEqual(kinds, [
								"config.toml [mcp_servers.owx_*]",
								"plugin mcp_servers overrides",
							]);
							return true;
						},
					});
				});
				const config = await readFile(configPath, "utf-8");
				assert.doesNotMatch(config, /mcp_servers\.owx_state/);
				assert.doesNotMatch(config, /mcp_servers\.owx_memory/);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("preserves plugin-mode top-level MCP registrations without duplicating them when removal is declined", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-plugin-mcp-preserve-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				const configPath = join(codexHomeDir, "config.toml");
				await writeFile(
					configPath,
					[
						"[mcp_servers.owx_state]",
						'command = "node"',
						"",
						"[mcp_servers.user_tool]",
						'command = "user-tool"',
						"",
					].join("\n"),
				);
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "plugin",
						firstPartyMcpRemovalPrompt: async () => false,
					});
				});
				const config = await readFile(configPath, "utf-8");
				assert.equal(config.match(/^\[mcp_servers\.owx_state\]$/gm)?.length, 1);
				assert.match(config, /^\[mcp_servers\.user_tool\]$/m);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("reports plugin marketplace registration during dry-run without mutating config", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const configPath = join(codexHomeDir, "config.toml");
					await writeFile(configPath, 'model = "gpt-5.5"\n');

					const output = await captureConsoleOutput(async () => {
						await setup({ scope: "user", installMode: "plugin", dryRun: true });
					});

					assert.match(
						output,
						/Would register local Codex plugin marketplace owen-codex-local/,
					);
					assert.equal(
						await readFile(configPath, "utf-8"),
						'model = "gpt-5.5"\n',
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("uses plugin-scoped hooks when plugin mode is selected", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
					});
					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
					});

					assert.equal(existsSync(join(codexHomeDir, "hooks.json")), false);
					const config = await readFile(
						join(codexHomeDir, "config.toml"),
						"utf-8",
					);
					assert.match(config, /^plugin_hooks = true$/m);
					assert.doesNotMatch(config, /^hooks = true$/m);
					assert.doesNotMatch(config, /^codex_hooks = true$/m);
					assert.match(config, /^goals = true$/m);
					assert.doesNotMatch(config, /\[hooks\.state\./);
					assert.doesNotMatch(config, /developer_instructions|notify-hook/g);
					assert.equal(
						existsSync(join(codexHomeDir, "skills", "ask", "SKILL.md")),
						false,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "agents", "planner.toml")),
						true,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "prompts", "executor.md")),
						false,
					);
					assert.equal(existsSync(join(codexHomeDir, "AGENTS.md")), false);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("can opt into plugin AGENTS.md and developer_instructions defaults", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						pluginAgentsMdPrompt: async () => true,
						pluginDeveloperInstructionsPrompt: async () => true,
					});

					assert.equal(existsSync(join(codexHomeDir, "hooks.json")), false);
					assert.equal(
						existsSync(join(codexHomeDir, "skills", "ask", "SKILL.md")),
						false,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "agents", "planner.toml")),
						true,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "prompts", "executor.md")),
						false,
					);

					const config = await readFile(
						join(codexHomeDir, "config.toml"),
						"utf-8",
					);
					assert.match(config, /developer_instructions\s*=/);
					assert.match(
						config,
						/Registered Codex plugin marketplace surfaces supply OWX workflows and plugin-scoped companion resources/,
					);
					assert.match(
						config,
						/User-installed skills may still live under ~\/.codex\/skills/,
					);
					assert.match(
						config,
						/native agent roles are installed as setup-owned Codex agent TOML files in plugin mode so agent_type routing works/i,
					);
					assert.match(
						config,
						/When shaping product behavior, make the core user loop stronger before adding breadth/,
					);
					assert.match(config, /never disguise failure as success/);
					assert.match(
						config,
						/When authoring source code, implement the intended behavior directly without fallback code/,
					);
					assert.match(config, /Prefer declarative, immutable, type-safe code/);
					assert.match(config, /Avoid unnecessary comments/);
					assert.doesNotMatch(
						config,
						/Native subagents live in \.codex\/agents/,
					);
					assert.doesNotMatch(
						config,
						/Treat installed prompts as narrower execution surfaces/,
					);
					assert.match(config, /^plugin_hooks = true$/m);
					assert.doesNotMatch(config, /notify-hook/);
					assert.doesNotMatch(config, /^\s*\[mcp_servers[.\]]/m);
					assert.doesNotMatch(config, /mcp_servers\.owx_state/);

					const agentsMd = await readFile(
						join(codexHomeDir, "AGENTS.md"),
						"utf-8",
					);
					assert.match(
						agentsMd,
						/owen-codex - Intelligent Multi-Agent Orchestration/,
					);
					assert.match(agentsMd, /<!-- owx:generated:agents-md -->/);
					assert.match(agentsMd, /<!-- OWX:MODELS:START -->/);
					assert.match(agentsMd, /<!-- OWX:MODELS:END -->/);
					assert.match(agentsMd, /<guidance_schema_contract>/);
					assert.match(agentsMd, /<execution_protocols>/);
					assert.match(
						agentsMd,
						/AGENTS\.md is the top-level operating contract/,
					);
					assert.match(
						agentsMd,
						/Registered Codex plugin marketplace surfaces supply OWX workflows and plugin-scoped companion resources/,
					);
					assert.match(
						agentsMd,
						/User-installed skills may still live under `~\/.codex\/skills`/,
					);
					assert.match(
						agentsMd,
						/native agent roles are installed as setup-owned Codex agent TOML files in plugin mode so agent_type routing works/i,
					);
					assert.match(agentsMd, /Product taste is a delivery constraint/);
					assert.match(
						agentsMd,
						/Make the core user loop stronger before adding breadth/,
					);
					assert.match(agentsMd, /Do not disguise failure as success/);
					assert.match(
						agentsMd,
						/do not add fallback code that masks missing state/,
					);
					assert.match(
						agentsMd,
						/Prefer declarative, immutable, type-safe code/,
					);
					assert.match(agentsMd, /Avoid unnecessary comments/);
					assert.doesNotMatch(agentsMd, /Role prompts under `prompts\/\*\.md`/);
					assert.doesNotMatch(
						agentsMd,
						/load the installed prompt\/skill\/agent surfaces from/,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("uses project-scoped plugin AGENTS.md wording without legacy prompt or agent paths", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					await setup({
						scope: "project",
						installMode: "plugin",
						pluginAgentsMdPrompt: async () => true,
						pluginDeveloperInstructionsPrompt: async () => false,
					});

					const agentsMd = await readFile(join(wd, "AGENTS.md"), "utf-8");
					assert.match(
						agentsMd,
						/Registered Codex plugin marketplace surfaces supply OWX workflows and plugin-scoped companion resources/,
					);
					assert.match(
						agentsMd,
						/User-installed skills may still live under `\.\/.codex\/skills` for project scope, or `~\/.codex\/skills` for user-installed skills/,
					);
					assert.doesNotMatch(agentsMd, /`~\/.codex\/prompts`/);
					assert.doesNotMatch(agentsMd, /`~\/.codex\/agents`/);
					assert.doesNotMatch(agentsMd, /Role prompts under `prompts\/\*\.md`/);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("preserves existing developer_instructions when plugin defaults are requested", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const configPath = join(codexHomeDir, "config.toml");
					const existingConfig = 'developer_instructions = "custom"\n';
					await writeFile(configPath, existingConfig);

					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						pluginDeveloperInstructionsPrompt: async () => true,
					});

					const config = await readFile(configPath, "utf-8");
					assert.match(config, /^developer_instructions = "custom"$/m);
					assert.match(config, /^plugin_hooks = true$/m);
					assert.equal(
						(config.match(/^developer_instructions\s*=/gm) ?? []).length,
						1,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("can overwrite existing developer_instructions after explicit plugin prompt approval", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const configPath = join(codexHomeDir, "config.toml");
					await writeFile(configPath, 'developer_instructions = "custom"\n');

					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						pluginDeveloperInstructionsPrompt: async () => true,
						pluginDeveloperInstructionsOverwritePrompt: async () => true,
					});

					const config = await readFile(configPath, "utf-8");
					assert.match(config, /You have owen-codex installed/);
					assert.doesNotMatch(config, /^developer_instructions = "custom"$/m);
					assert.equal(
						(config.match(/^developer_instructions\s*=/gm) ?? []).length,
						1,
					);
					assert.match(config, /^plugin_hooks = true$/m);
					assert.doesNotMatch(config, /\[hooks\.state\./);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("uses legacy codex_hooks only when the installed Codex reports that hook feature", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: () =>
							"codex_hooks                             experimental       true\n",
						codexVersionProbe: () => "codex-cli 0.129.0",
					});

					const config = await readFile(
						join(codexHomeDir, "config.toml"),
						"utf-8",
					);
					assert.match(config, /^codex_hooks = true$/m);
					assert.doesNotMatch(config, /^hooks = true$/m);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("removes legacy setup-managed hook wrappers when plugin-scoped hooks are supported", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: () =>
							"hooks                                   stable             true\n",
					});

					const hooksPath = join(codexHomeDir, "hooks.json");
					assert.equal(existsSync(hooksPath), true);

					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: () =>
							[
								"hooks                                   stable             true",
								"plugin_hooks                            experimental       true",
								"",
							].join("\n"),
					});

					assert.equal(existsSync(hooksPath), false);
					const config = await readFile(
						join(codexHomeDir, "config.toml"),
						"utf-8",
					);
					assert.match(config, /^plugin_hooks = true$/m);
					assert.doesNotMatch(config, /^hooks = true$/m);
					assert.doesNotMatch(config, /\[hooks\.state\./);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("preserves existing user hooks while using plugin-scoped hooks", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const hooksPath = join(codexHomeDir, "hooks.json");
					const existingHooks =
						JSON.stringify({ hooks: { UserPromptSubmit: [] } }, null, 2) + "\n";
					await writeFile(hooksPath, existingHooks);

					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
					});

					const hooks = await readFile(hooksPath, "utf-8");
					assert.match(hooks, /"UserPromptSubmit"/);
					assert.doesNotMatch(hooks, /codex-native-hook\.js/);
					const config = await readFile(
						join(codexHomeDir, "config.toml"),
						"utf-8",
					);
					assert.match(config, /^plugin_hooks = true$/m);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("preserves same-key user hook trust state in plugin-scoped setup", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const hooksPath = join(codexHomeDir, "hooks.json");
					const configPath = join(codexHomeDir, "config.toml");
					await writeFile(
						hooksPath,
						JSON.stringify(
							{
								hooks: {
									PostCompact: [
										{
											hooks: [
												{
													type: "command",
													command: "/usr/bin/python3 /tmp/user-hook.py",
													timeout: 5,
												},
											],
										},
									],
								},
							},
							null,
							2,
						) + "\n",
					);
					await writeFile(
						configPath,
						[
							'model = "gpt-5.5"',
							"",
							`[hooks.state."${hooksPath}:post_compact:0:0"]`,
							'trusted_hash = "sha256:user"',
							"enabled = false",
							"",
						].join("\n"),
					);

					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
					});

					const config = await readFile(configPath, "utf-8");
					assert.match(config, /^plugin_hooks = true$/m);
					assert.match(config, /^trusted_hash = "sha256:user"$/m);
					assert.match(config, /^enabled = false$/m);
					assert.equal(
						config
							.split(/\r?\n/)
							.filter(
								(line) =>
									line.trim() ===
									`[hooks.state."${hooksPath}:post_compact:0:0"]`,
							).length,
						1,
						"plugin setup must not duplicate preserved user hook trust state",
					);
					assert.doesNotThrow(() => parseToml(config));
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("honors persisted project-scoped plugin mode on repeat setup", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withTempCwd(wd, async () => {
				await setup({
					scope: "project",
					installMode: "plugin",
					codexFeaturesProbe: pluginScopedHooksFeatureProbe,
				});

				const persisted = JSON.parse(
					await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
				) as { scope: string; installMode?: string };
				assert.deepEqual(persisted, {
					scope: "project",
					installMode: "plugin",
					mcpMode: "none",
				});

				await setup({ scope: "project" });

				assert.equal(
					existsSync(join(wd, ".codex", "skills", "ask", "SKILL.md")),
					false,
				);
				assert.equal(
					existsSync(join(wd, ".codex", "agents", "planner.toml")),
					true,
				);
				assert.equal(
					existsSync(join(wd, ".codex", "prompts", "executor.md")),
					false,
				);
				assert.equal(existsSync(join(wd, ".codex", "hooks.json")), false);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("lets explicit project legacy setup clear persisted project plugin mode", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withTempCwd(wd, async () => {
				await mkdir(join(wd, ".owx"), { recursive: true });
				await writeFile(
					join(wd, ".owx", "setup-scope.json"),
					JSON.stringify({ scope: "project", installMode: "plugin" }),
				);

				await setup({ scope: "project", installMode: "legacy" });

				const persisted = JSON.parse(
					await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
				) as { scope: string; installMode?: string };
				assert.deepEqual(persisted, { scope: "project", mcpMode: "none" });
				assert.equal(
					existsSync(join(wd, ".codex", "skills", "ask", "SKILL.md")),
					true,
				);
				assert.equal(
					existsSync(join(wd, ".codex", "agents", "planner.toml")),
					true,
				);
				assert.equal(
					existsSync(join(wd, ".codex", "prompts", "executor.md")),
					true,
				);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("lets explicit user legacy setup override persisted user plugin mode", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await mkdir(join(wd, ".owx"), { recursive: true });
					await writeFile(
						join(wd, ".owx", "setup-scope.json"),
						JSON.stringify({ scope: "user", installMode: "plugin" }),
					);

					await setup({ installMode: "legacy" });

					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, {
						scope: "user",
						installMode: "legacy",
						mcpMode: "none",
					});
					assert.equal(
						existsSync(join(codexHomeDir, "skills", "ask", "SKILL.md")),
						true,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "agents", "planner.toml")),
						true,
					);
					assert.equal(
						existsSync(join(codexHomeDir, "prompts", "executor.md")),
						true,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("dedupes plugin-mode hook trust state when switching user setup back to legacy", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					const configPath = join(codexHomeDir, "config.toml");

					await setup({ scope: "user", installMode: "plugin", force: true });
					const pluginConfig = await readFile(configPath, "utf-8");
					const staleUnfencedPluginConfig = pluginConfig
						.split(/\r?\n/)
						.filter(
							(line) =>
								line.trim() !== "# OWX-owned Codex hook trust state" &&
								line.trim() !==
									"# Trusts only setup-managed codex-native-hook.js wrappers." &&
								line.trim() !== "# End OWX-owned Codex hook trust state",
						)
						.join("\n");
					await writeFile(configPath, staleUnfencedPluginConfig);
					assert.doesNotThrow(() => parseToml(staleUnfencedPluginConfig));

					await setup({ scope: "user", installMode: "legacy", force: true });

					const legacyConfig = await readFile(configPath, "utf-8");
					assert.doesNotThrow(() => parseToml(legacyConfig));
					assert.equal(
						legacyConfig
							.split(/\r?\n/)
							.filter(
								(line) =>
									line.trim() ===
									`[hooks.state."${join(codexHomeDir, "hooks.json")}:post_compact:0:0"]`,
							).length,
						1,
						"legacy setup should replace stale plugin-mode hook trust state instead of duplicating it",
					);
					assert.match(
						legacyConfig,
						/# OWX-owned Codex hook trust state[\s\S]*# End OWX-owned Codex hook trust state/,
					);
					const persisted = JSON.parse(
						await readFile(join(wd, ".owx", "setup-scope.json"), "utf-8"),
					) as { scope: string; installMode?: string };
					assert.deepEqual(persisted, {
						scope: "user",
						installMode: "legacy",
						mcpMode: "none",
					});
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("uses project-scoped plugin hooks when plugin mode is explicitly requested", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withTempCwd(wd, async () => {
				await setup({
					scope: "project",
					installMode: "plugin",
					codexFeaturesProbe: pluginScopedHooksFeatureProbe,
				});

				await assertProjectPluginModeArtifacts(wd);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("honors persisted project plugin mode on repeat setup", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withTempCwd(wd, async () => {
				await setup({
					scope: "project",
					installMode: "plugin",
					codexFeaturesProbe: pluginScopedHooksFeatureProbe,
				});
				await setup({ codexFeaturesProbe: pluginScopedHooksFeatureProbe });

				await assertProjectPluginModeArtifacts(wd);
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("prints plugin-mode next steps without legacy-only claims", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async () => {
				await withTempCwd(wd, async () => {
					const pluginOutput = await captureConsoleOutput(async () => {
						await setup({
							scope: "project",
							installMode: "plugin",
							codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						});
					});
					assert.match(pluginOutput, /Using setup install mode: plugin/);
					assert.match(
						pluginOutput,
						/Plugin-scoped Codex hooks and runtime feature flags refresh complete .*plugin_hooks, goals/,
					);
					assert.doesNotMatch(pluginOutput, /user-scope skill delivery mode/);
					assert.doesNotMatch(
						pluginOutput,
						/Native agent defaults configured.*TOML files written to \.codex\/agents\//,
					);
					assert.doesNotMatch(
						pluginOutput,
						/Use role\/workflow keywords like \$architect, \$executor, and \$plan/,
					);
					assert.doesNotMatch(
						pluginOutput,
						/AGENTS keyword routing can also activate them implicitly/,
					);
					assert.doesNotMatch(
						pluginOutput,
						/The AGENTS\.md orchestration brain is loaded automatically/,
					);
					assert.match(
						pluginOutput,
						/Registered Codex marketplace owen-codex-local supplies OWX skills and workflow surfaces/,
					);
					assert.match(
						pluginOutput,
						/Browse plugin-provided skills with \/skills/,
					);
					assert.match(
						pluginOutput,
						/Optional AGENTS\.md and developer_instructions defaults are only installed when selected/,
					);

					const legacyWd = join(wd, "legacy");
					await mkdir(legacyWd, { recursive: true });
					await withTempCwd(legacyWd, async () => {
						const legacyOutput = await captureConsoleOutput(async () => {
							await setup({ scope: "user", installMode: "legacy" });
						});
						assert.match(
							legacyOutput,
							/Native agent defaults configured.*TOML files written to \.codex\/agents\//,
						);
						assert.match(
							legacyOutput,
							/Use role\/workflow keywords like \$architect, \$executor, and \$plan/,
						);
						assert.match(
							legacyOutput,
							/AGENTS keyword routing can also activate them implicitly/,
						);
						assert.match(
							legacyOutput,
							/The AGENTS\.md orchestration brain is loaded automatically/,
						);
					});
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("removes legacy user components when plugin mode is selected", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "legacy" });

					const askSkillPath = join(codexHomeDir, "skills", "ask", "SKILL.md");
					const promptPath = join(codexHomeDir, "prompts", "executor.md");
					const agentPath = join(codexHomeDir, "agents", "planner.toml");
					const hooksPath = join(codexHomeDir, "hooks.json");
					const configPath = join(codexHomeDir, "config.toml");
					const agentsMdPath = join(codexHomeDir, "AGENTS.md");
					assert.equal(existsSync(askSkillPath), true);
					assert.equal(existsSync(promptPath), true);
					assert.equal(existsSync(agentPath), true);
					assert.equal(existsSync(hooksPath), true);
					assert.equal(existsSync(configPath), true);
					assert.equal(existsSync(agentsMdPath), true);

					await setup({
						scope: "user",
						installMode: "plugin",
						codexFeaturesProbe: pluginScopedHooksFeatureProbe,
					});

					assert.equal(existsSync(askSkillPath), false);
					assert.equal(existsSync(promptPath), false);
					assert.equal(existsSync(agentPath), true);
					assert.equal(existsSync(hooksPath), false);
					assert.equal(existsSync(agentsMdPath), false);
					const config = await readFile(configPath, "utf-8");
					assert.match(config, /^plugin_hooks = true$/m);
					assert.doesNotMatch(
						config,
						/^\s*(?:notify|developer_instructions)\s*=|^\s*\[mcp_servers[.\]]/m,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("archives stale legacy prompts and refreshes generated native agents when plugin mode refreshes", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "legacy" });

					const promptPath = join(codexHomeDir, "prompts", "executor.md");
					const agentPath = join(codexHomeDir, "agents", "planner.toml");
					await writeFile(
						promptPath,
						"---\ndescription: stale legacy executor prompt\n---\n\nold executor body\n",
					);
					await writeFile(
						agentPath,
						[
							"# owen-codex agent: planner",
							'name = "planner"',
							'description = "stale legacy generated planner"',
							'developer_instructions = """old planner body"""',
							"",
						].join("\n"),
					);

					const output = await captureConsoleOutput(async () => {
						await setup({
							scope: "user",
							installMode: "plugin",
							codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						});
					});

					assert.equal(existsSync(promptPath), false);
					assert.equal(existsSync(agentPath), true);
					assert.match(
						await readFile(agentPath, "utf-8"),
						/^name = "planner"$/m,
					);
					assert.match(
						output,
						/Archived and removed .* legacy OWX-managed prompt file/,
					);
					assert.match(output, /Native agent role refresh complete/);

					const backupRoot = join(wd, "home", ".owx", "backups", "setup");
					const backupRuns = await readdir(backupRoot);
					assert.ok(backupRuns.length > 0);
					assert.equal(
						backupRuns.some((entry) =>
							existsSync(
								join(backupRoot, entry, ".codex", "prompts", "executor.md"),
							),
						),
						true,
					);
					assert.equal(
						backupRuns.some((entry) =>
							existsSync(
								join(backupRoot, entry, ".codex", "agents", "planner.toml"),
							),
						),
						true,
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("preserves unmanaged native agent TOMLs with obsolete skill_ref during plugin refresh", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "legacy" });

					const customAgentPath = join(
						codexHomeDir,
						"agents",
						"custom-reviewer.toml",
					);
					const generatedAgentPath = join(codexHomeDir, "agents", "ghost.toml");
					const customAgentToml = [
						'name = "custom-reviewer"',
						'description = "user-managed reviewer"',
						'skill_ref = "custom-reviewer"',
						"",
					].join("\n");
					await writeFile(customAgentPath, customAgentToml);
					await writeFile(
						generatedAgentPath,
						[
							"# owen-codex agent: ghost",
							'name = "ghost"',
							'description = "obsolete generated reviewer"',
							'skill_ref = "ghost"',
							"",
						].join("\n"),
					);

					await setup({ scope: "user", installMode: "plugin" });

					assert.equal(
						await readFile(customAgentPath, "utf-8"),
						customAgentToml,
					);
					assert.equal(existsSync(generatedAgentPath), false);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("counts plugin cleanup skill directory backups in the setup summary", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "legacy" });
					await seedPluginCacheFromInstalledSkills(codexHomeDir);

					const output = await captureConsoleOutput(async () => {
						await setup({
							scope: "user",
							installMode: "plugin",
							codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						});
					});

					const skillsSummary = output.match(
						/skills: updated=0, unchanged=0, backed_up=(\d+), skipped=0, removed=(\d+)/,
					);
					assert.notEqual(skillsSummary, null);
					const backedUp = Number(skillsSummary?.[1]);
					const removed = Number(skillsSummary?.[2]);
					assert.ok(backedUp > 0);
					assert.equal(backedUp, removed);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("removes matching legacy user skills even when plugin readiness is proven", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "legacy" });
					await seedPluginCacheFromInstalledSkills(codexHomeDir);

					const askSkillDir = join(codexHomeDir, "skills", "ask");
					const wikiSkillDir = join(codexHomeDir, "skills", "wiki");
					assert.equal(existsSync(askSkillDir), true);
					assert.equal(existsSync(wikiSkillDir), true);

					const outputLines: string[] = [];
					const previousLog = console.log;
					console.log = (...args: unknown[]) => {
						outputLines.push(args.join(" "));
					};
					try {
						await setup({
							scope: "user",
							installMode: "plugin",
							codexFeaturesProbe: pluginScopedHooksFeatureProbe,
						});
					} finally {
						console.log = previousLog;
					}

					const setupOutput = outputLines.join("\n");
					assert.equal(existsSync(askSkillDir), false);
					assert.equal(existsSync(wikiSkillDir), false);
					assert.match(
						setupOutput,
						/skills: updated=0, unchanged=0, backed_up=\d+, skipped=0, removed=\d+/,
					);

					const backupSetupRoot = join(wd, "home", ".owx", "backups", "setup");
					const backupTimestamps = await readdir(backupSetupRoot);
					assert.equal(backupTimestamps.length, 1);
					const backupSkillsDir = join(
						backupSetupRoot,
						backupTimestamps[0],
						".codex",
						"skills",
					);
					const backedUpSkillNames = await readdir(backupSkillsDir);
					assert.ok(backedUpSkillNames.includes("ask"));
					assert.ok(backedUpSkillNames.includes("wiki"));
					assert.match(
						setupOutput,
						new RegExp(
							`skills: updated=0, unchanged=0, backed_up=${backedUpSkillNames.length}, skipped=0, removed=${backedUpSkillNames.length}`,
						),
					);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});

	it("preserves customized legacy user skills during plugin cleanup", async () => {
		const wd = await mkdtemp(join(tmpdir(), "owx-setup-install-mode-"));
		try {
			await withIsolatedUserHome(wd, async (codexHomeDir) => {
				await withTempCwd(wd, async () => {
					await setup({ scope: "user", installMode: "legacy" });
					await seedPluginCacheFromInstalledSkills(codexHomeDir);

					const askSkillPath = join(codexHomeDir, "skills", "ask", "SKILL.md");
					const wikiSkillDir = join(codexHomeDir, "skills", "wiki");
					await writeFile(askSkillPath, "# customized ask\n");

					await setup({ scope: "user", installMode: "plugin" });

					assert.equal(
						await readFile(askSkillPath, "utf-8"),
						"# customized ask\n",
					);
					assert.equal(existsSync(wikiSkillDir), false);
				});
			});
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});
});
