import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const NOTICE_NAME = "Legacy OWX context defaults";
const NOTICE_COPY =
	'config.toml contains unchanged OWX-seeded context defaults; rerun "owx setup" to migrate them. Doctor did not rewrite config.';
const SEEDED_PAIR = [
	"# owen-codex seeded behavioral defaults (uninstall removes unchanged defaults)",
	"model_context_window = 250000",
	"model_auto_compact_token_limit = 200000",
	"# End owen-codex seeded behavioral defaults",
].join("\n");

function runOwx(
	cwd: string,
	argv: string[],
	envOverrides: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string; error?: string } {
	const testDir = dirname(fileURLToPath(import.meta.url));
	const repoRoot = join(testDir, "..", "..", "..");
	const owxBin = join(repoRoot, "dist", "cli", "owx.js");
	const result = spawnSync(process.execPath, [owxBin, ...argv], {
		cwd,
		encoding: "utf-8",
		env: { ...process.env, ...envOverrides },
	});
	return {
		status: result.status,
		stdout: result.stdout || "",
		stderr: result.stderr || "",
		error: result.error?.message,
	};
}

function shouldSkipForSpawnPermissions(error?: string): boolean {
	return typeof error === "string" && /(EPERM|EACCES)/i.test(error);
}

function noticeLines(stdout: string): string[] {
	return stdout
		.split("\n")
		.filter((line) => line.includes(`[!!] ${NOTICE_NAME}:`));
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function withConfig(
	config: string,
	fn: (args: {
		wd: string;
		home: string;
		codexDir: string;
		configPath: string;
	}) => Promise<void>,
): Promise<void> {
	const wd = await mkdtemp(join(tmpdir(), "owx-doctor-context-window-"));
	try {
		const home = join(wd, "home");
		const codexDir = join(home, ".codex");
		const configPath = join(codexDir, "config.toml");
		await mkdir(codexDir, { recursive: true });
		await writeFile(configPath, config);
		await fn({ wd, home, codexDir, configPath });
	} finally {
		await rm(wd, { recursive: true, force: true });
	}
}

describe("owx doctor seeded context defaults diagnostic", () => {
	it("emits one read-only migration notice only for the unchanged exact OWX-owned pair", async () => {
		await withConfig(
			`${SEEDED_PAIR}\n`,
			async ({ wd, home, codexDir, configPath }) => {
				const before = await readFile(configPath, "utf-8");
				const result = runOwx(wd, ["doctor"], {
					HOME: home,
					CODEX_HOME: codexDir,
				});
				if (shouldSkipForSpawnPermissions(result.error)) return;

				assert.equal(result.status, 0, result.stderr || result.stdout);
				assert.deepEqual(noticeLines(result.stdout), [
					`  [!!] ${NOTICE_NAME}: ${NOTICE_COPY}`,
				]);
				assert.equal(
					sha256(await readFile(configPath, "utf-8")),
					sha256(before),
				);
			},
		);
	});

	it("suppresses the migration notice when Config cannot parse the file", async () => {
		await withConfig(
			`${SEEDED_PAIR}\ninvalid = [\n`,
			async ({ wd, home, codexDir, configPath }) => {
				const before = await readFile(configPath, "utf-8");
				const result = runOwx(wd, ["doctor"], {
					HOME: home,
					CODEX_HOME: codexDir,
				});
				if (shouldSkipForSpawnPermissions(result.error)) return;

				assert.equal(result.status, 0, result.stderr || result.stdout);
				assert.match(result.stdout, /\[XX\] Config: invalid config\.toml/);
				assert.deepEqual(noticeLines(result.stdout), []);
				assert.equal(await readFile(configPath, "utf-8"), before);
			},
		);
	});

	it("is silent for non-exact, unowned, and unrelated context values", async () => {
		const silentConfigs = [
			"model_context_window = 250000\n",
			"# owen-codex seeded behavioral defaults (uninstall removes unchanged defaults)\nmodel_context_window = 250000\n# End owen-codex seeded behavioral defaults\n",
			"# owen-codex seeded behavioral defaults (uninstall removes unchanged defaults)\nmodel_context_window = 250001\nmodel_auto_compact_token_limit = 200000\n# End owen-codex seeded behavioral defaults\n",
			"model_context_window = 250000\nmodel_auto_compact_token_limit = 200000\n",
			'model = "o3"\nmodel_context_window = 1000000\nmodel_auto_compact_token_limit = 900000\n',
			"model_context_window = 999\n# owen-codex seeded behavioral defaults (uninstall removes unchanged defaults)\nmodel_context_window = 250000\nmodel_auto_compact_token_limit = 200000\n# End owen-codex seeded behavioral defaults\n",
		];

		for (const config of silentConfigs) {
			await withConfig(config, async ({ wd, home, codexDir, configPath }) => {
				const before = await readFile(configPath, "utf-8");
				const result = runOwx(wd, ["doctor"], {
					HOME: home,
					CODEX_HOME: codexDir,
				});
				if (shouldSkipForSpawnPermissions(result.error)) return;

				assert.equal(result.status, 0, result.stderr || result.stdout);
				assert.deepEqual(noticeLines(result.stdout), [], config);
				assert.equal(await readFile(configPath, "utf-8"), before);
			});
		}
	});
});
