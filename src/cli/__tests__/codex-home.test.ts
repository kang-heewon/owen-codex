import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	resolveCodexConfigPathForLaunch,
	resolveCodexHomeForLaunch,
	resolveProjectLocalCodexHomeForLaunch,
} from "../codex-home.js";

describe("project launch scope resolution", () => {
	it("uses the nearest ancestor project Codex home from a subdirectory", async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), "owx-launch-scope-"));
		try {
			await mkdir(join(projectRoot, ".owx"), { recursive: true });
			await writeFile(
				join(projectRoot, ".owx", "setup-scope.json"),
				JSON.stringify({ scope: "project" }),
			);
			const nested = join(projectRoot, "packages", "app", "src");
			await mkdir(nested, { recursive: true });

			assert.equal(
				resolveCodexHomeForLaunch(nested, {}),
				join(projectRoot, ".codex"),
			);
			assert.equal(
				resolveCodexConfigPathForLaunch(nested, {}),
				join(projectRoot, ".codex", "config.toml"),
			);
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it("stops at a malformed nearer marker instead of using a parent project", async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), "owx-launch-scope-"));
		try {
			await mkdir(join(projectRoot, ".owx"), { recursive: true });
			await writeFile(
				join(projectRoot, ".owx", "setup-scope.json"),
				JSON.stringify({ scope: "project" }),
			);
			const nestedRoot = join(projectRoot, "packages", "app");
			const nested = join(nestedRoot, "src");
			await mkdir(join(nestedRoot, ".owx"), { recursive: true });
			await mkdir(nested, { recursive: true });
			await writeFile(
				join(nestedRoot, ".owx", "setup-scope.json"),
				"{not-json",
			);

			assert.equal(
				resolveProjectLocalCodexHomeForLaunch(nested, {}),
				undefined,
			);
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it("keeps a nearer user scope on the user Codex home", async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), "owx-launch-scope-"));
		try {
			await mkdir(join(projectRoot, ".owx"), { recursive: true });
			await writeFile(
				join(projectRoot, ".owx", "setup-scope.json"),
				JSON.stringify({ scope: "project" }),
			);
			const nestedRoot = join(projectRoot, "packages", "app");
			const nested = join(nestedRoot, "src");
			await mkdir(join(nestedRoot, ".owx"), { recursive: true });
			await mkdir(nested, { recursive: true });
			await writeFile(
				join(nestedRoot, ".owx", "setup-scope.json"),
				JSON.stringify({ scope: "user" }),
			);

			assert.equal(
				resolveProjectLocalCodexHomeForLaunch(nested, {}),
				undefined,
			);
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it("preserves an explicit CODEX_HOME", async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), "owx-launch-scope-"));
		try {
			await mkdir(join(projectRoot, ".owx"), { recursive: true });
			await writeFile(
				join(projectRoot, ".owx", "setup-scope.json"),
				JSON.stringify({ scope: "project" }),
			);
			const explicitCodexHome = join(projectRoot, "explicit-codex-home");

			assert.equal(
				resolveCodexHomeForLaunch(projectRoot, {
					CODEX_HOME: explicitCodexHome,
				}),
				explicitCodexHome,
			);
			assert.equal(
				resolveProjectLocalCodexHomeForLaunch(projectRoot, {
					CODEX_HOME: explicitCodexHome,
				}),
				undefined,
			);
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
