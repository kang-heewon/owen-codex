import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { existsSync } from "fs";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "fs/promises";
import {
  codexHome,
  codexConfigPath,
  codexPromptsDir,
  userSkillsDir,
  projectSkillsDir,
  legacyUserSkillsDir,
  listInstalledSkillDirectories,
  detectLegacySkillRootOverlap,
  owxStateDir,
  owxRoot,
  owxProjectMemoryPath,
  canonicalProjectMemoryPath,
  projectMemoryPathCandidates,
  resolveProjectMemoryPath,
  owxNotepadPath,
  owxPlansDir,
  owxAdaptersDir,
  owxLogsDir,
  packageRoot,
  canonicalizeComparablePath,
  OWX_ENTRY_PATH_ENV,
  OWX_STARTUP_CWD_ENV,
  rememberOmxLaunchContext,
  resolveOmxCliEntryPath,
  resolveOmxEntryPath,
} from "../paths.js";

describe("codexHome", () => {
  let originalCodexHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalCodexHome = process.env.CODEX_HOME;
    originalUserProfile = process.env.USERPROFILE;
  });

  afterEach(() => {
    if (typeof originalCodexHome === "string") {
      process.env.CODEX_HOME = originalCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }

    if (typeof originalUserProfile === "string") {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it("returns CODEX_HOME env var when set", () => {
    process.env.CODEX_HOME = "/tmp/custom-codex";
    assert.equal(codexHome(), "/tmp/custom-codex");
  });

  it("defaults to ~/.codex when CODEX_HOME is not set", () => {
    delete process.env.CODEX_HOME;
    assert.equal(codexHome(), join(homedir(), ".codex"));
  });
});

describe("codexConfigPath", () => {
  let originalCodexHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalCodexHome = process.env.CODEX_HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.CODEX_HOME = "/tmp/test-codex";
  });

  afterEach(() => {
    if (typeof originalCodexHome === "string") {
      process.env.CODEX_HOME = originalCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }

    if (typeof originalUserProfile === "string") {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it("returns config.toml under codex home", () => {
    assert.equal(codexConfigPath(), join("/tmp/test-codex", "config.toml"));
  });
});

describe("codexPromptsDir", () => {
  let originalCodexHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalCodexHome = process.env.CODEX_HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.CODEX_HOME = "/tmp/test-codex";
  });

  afterEach(() => {
    if (typeof originalCodexHome === "string") {
      process.env.CODEX_HOME = originalCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }

    if (typeof originalUserProfile === "string") {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it("returns prompts/ under codex home", () => {
    assert.equal(codexPromptsDir(), join("/tmp/test-codex", "prompts"));
  });
});

describe("userSkillsDir", () => {
  let originalCodexHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalCodexHome = process.env.CODEX_HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.CODEX_HOME = "/tmp/test-codex";
  });

  afterEach(() => {
    if (typeof originalCodexHome === "string") {
      process.env.CODEX_HOME = originalCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }

    if (typeof originalUserProfile === "string") {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it("returns CODEX_HOME/skills", () => {
    assert.equal(userSkillsDir(), join("/tmp/test-codex", "skills"));
  });
});

describe("projectSkillsDir", () => {
  it("uses provided projectRoot", () => {
    assert.equal(projectSkillsDir("/my/project"), join("/my/project", ".codex", "skills"));
  });

  it("defaults to cwd when no projectRoot given", () => {
    assert.equal(projectSkillsDir(), join(process.cwd(), ".codex", "skills"));
  });
});

describe("legacyUserSkillsDir", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = "/tmp/test-home";
    process.env.USERPROFILE = "/tmp/test-home";
  });

  afterEach(() => {
    if (typeof originalHome === "string") {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (typeof originalUserProfile === "string") {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it("returns ~/.agents/skills under HOME", () => {
    assert.equal(legacyUserSkillsDir(), join("/tmp/test-home", ".agents", "skills"));
  });
});

describe("owxAdaptersDir", () => {
  it("returns .owx/adapters under the project root", () => {
    assert.equal(owxAdaptersDir("/my/project"), join("/my/project", ".owx", "adapters"));
  });
});

describe("listInstalledSkillDirectories", () => {
  let originalCodexHome: string | undefined;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalCodexHome = process.env.CODEX_HOME;
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
  });

  afterEach(() => {
    if (typeof originalCodexHome === "string") {
      process.env.CODEX_HOME = originalCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }

    if (typeof originalHome === "string") {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (typeof originalUserProfile === "string") {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it("deduplicates by skill name and prefers project skills over user skills", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "owx-paths-project-"));
    const codexHomeRoot = await mkdtemp(join(tmpdir(), "owx-paths-codex-"));
    process.env.CODEX_HOME = codexHomeRoot;

    try {
      const projectHelpDir = join(projectRoot, ".codex", "skills", "help");
      const projectOnlyDir = join(
        projectRoot,
        ".codex",
        "skills",
        "project-only",
      );
      const userHelpDir = join(codexHomeRoot, "skills", "help");
      const userOnlyDir = join(codexHomeRoot, "skills", "user-only");

      await mkdir(projectHelpDir, { recursive: true });
      await mkdir(projectOnlyDir, { recursive: true });
      await mkdir(userHelpDir, { recursive: true });
      await mkdir(userOnlyDir, { recursive: true });

      await writeFile(join(projectHelpDir, "SKILL.md"), "# project help\n");
      await writeFile(join(projectOnlyDir, "SKILL.md"), "# project only\n");
      await writeFile(join(userHelpDir, "SKILL.md"), "# user help\n");
      await writeFile(join(userOnlyDir, "SKILL.md"), "# user only\n");

      const skills = await listInstalledSkillDirectories(projectRoot);

      assert.deepEqual(
        skills.map((skill) => ({
          name: skill.name,
          scope: skill.scope,
        })),
        [
          { name: "help", scope: "project" },
          { name: "project-only", scope: "project" },
          { name: "user-only", scope: "user" },
        ],
      );
      assert.equal(skills[0]?.path, projectHelpDir);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(codexHomeRoot, { recursive: true, force: true });
    }
  });
  it("detects overlapping legacy and canonical user skill roots including content mismatches", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "owx-paths-home-"));
    const codexHomeRoot = join(homeRoot, ".codex");
    const legacyRoot = join(homeRoot, ".agents", "skills");
    process.env.HOME = homeRoot;
    process.env.USERPROFILE = homeRoot;
    process.env.CODEX_HOME = codexHomeRoot;

    try {
      const canonicalHelpDir = join(codexHomeRoot, "skills", "help");
      const canonicalPlanDir = join(codexHomeRoot, "skills", "plan");
      const legacyHelpDir = join(legacyRoot, "help");
      const legacyOnlyDir = join(legacyRoot, "legacy-only");

      await mkdir(canonicalHelpDir, { recursive: true });
      await mkdir(canonicalPlanDir, { recursive: true });
      await mkdir(legacyHelpDir, { recursive: true });
      await mkdir(legacyOnlyDir, { recursive: true });

      await writeFile(join(canonicalHelpDir, "SKILL.md"), "# canonical help\n");
      await writeFile(join(canonicalPlanDir, "SKILL.md"), "# canonical plan\n");
      await writeFile(join(legacyHelpDir, "SKILL.md"), "# legacy help\n");
      await writeFile(join(legacyOnlyDir, "SKILL.md"), "# legacy only\n");

      const overlap = await detectLegacySkillRootOverlap();

      assert.equal(overlap.canonicalExists, true);
      assert.equal(overlap.legacyExists, true);
      assert.equal(overlap.canonicalSkillCount, 2);
      assert.equal(overlap.legacySkillCount, 2);
      assert.deepEqual(overlap.overlappingSkillNames, ["help"]);
      assert.deepEqual(overlap.mismatchedSkillNames, ["help"]);
      assert.equal(overlap.sameResolvedTarget, false);
    } finally {
      await rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("treats a legacy link to canonical skills as the same resolved target", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "owx-paths-linked-home-"));
    const codexHomeRoot = join(homeRoot, ".codex");
    const canonicalSkillsRoot = join(codexHomeRoot, "skills");
    const legacyParent = join(homeRoot, ".agents");
    const legacyRoot = join(legacyParent, "skills");
    process.env.HOME = homeRoot;
    process.env.USERPROFILE = homeRoot;
    process.env.CODEX_HOME = codexHomeRoot;

    try {
      const canonicalHelpDir = join(canonicalSkillsRoot, "help");
      await mkdir(canonicalHelpDir, { recursive: true });
      await mkdir(legacyParent, { recursive: true });
      await writeFile(join(canonicalHelpDir, "SKILL.md"), "# canonical help\n");
      await symlink(
        canonicalSkillsRoot,
        legacyRoot,
        process.platform === "win32" ? "junction" : "dir",
      );

      const overlap = await detectLegacySkillRootOverlap();

      assert.equal(overlap.canonicalExists, true);
      assert.equal(overlap.legacyExists, true);
      assert.equal(overlap.canonicalSkillCount, 1);
      assert.equal(overlap.legacySkillCount, 1);
      assert.equal(overlap.sameResolvedTarget, true);
      assert.deepEqual(overlap.overlappingSkillNames, ["help"]);
      assert.deepEqual(overlap.mismatchedSkillNames, []);
    } finally {
      await rm(homeRoot, { recursive: true, force: true });
    }
  });
});

describe("owxStateDir", () => {
  let originalOmxRoot: string | undefined;
  let originalOmxStateRoot: string | undefined;

  beforeEach(() => {
    originalOmxRoot = process.env.OWX_ROOT;
    originalOmxStateRoot = process.env.OWX_STATE_ROOT;
  });

  afterEach(() => {
    if (typeof originalOmxRoot === "string") process.env.OWX_ROOT = originalOmxRoot;
    else delete process.env.OWX_ROOT;
    if (typeof originalOmxStateRoot === "string") process.env.OWX_STATE_ROOT = originalOmxStateRoot;
    else delete process.env.OWX_STATE_ROOT;
  });

  it("uses provided projectRoot", () => {
    assert.equal(owxStateDir("/my/project"), join("/my/project", ".owx", "state"));
  });

  it("defaults to cwd when no projectRoot given", () => {
    assert.equal(owxStateDir(), join(process.cwd(), ".owx", "state"));
  });

  it("uses OWX_ROOT override when set", () => {
    process.env.OWX_ROOT = "/tmp/owx-root";
    assert.equal(owxRoot("/ignored/project"), "/tmp/owx-root/.owx");
    assert.equal(owxStateDir("/ignored/project"), "/tmp/owx-root/.owx/state");
  });

  it("uses OWX_ROOT as boxed workspace root for all runtime paths", () => {
    process.env.OWX_ROOT = "/tmp/owx-box";
    assert.equal(owxRoot("/ignored/project"), "/tmp/owx-box/.owx");
    assert.equal(owxStateDir("/ignored/project"), "/tmp/owx-box/.owx/state");
    assert.equal(owxProjectMemoryPath("/ignored/project"), "/tmp/owx-box/.owx/project-memory.json");
    assert.equal(owxNotepadPath("/ignored/project"), "/tmp/owx-box/.owx/notepad.md");
    assert.equal(owxPlansDir("/ignored/project"), "/tmp/owx-box/.owx/plans");
    assert.equal(owxLogsDir("/ignored/project"), "/tmp/owx-box/.owx/logs");
  });
});

describe("owxProjectMemoryPath", () => {
  it("uses provided projectRoot", () => {
    assert.equal(
      owxProjectMemoryPath("/my/project"),
      join("/my/project", ".owx", "project-memory.json"),
    );
  });

  it("defaults to cwd when no projectRoot given", () => {
    assert.equal(
      owxProjectMemoryPath(),
      join(process.cwd(), ".owx", "project-memory.json"),
    );
  });
});

describe("project memory startup path resolution", () => {
  it("prefers repository project-memory.json over legacy .owx/project-memory.json", async () => {
    const wd = await mkdtemp(join(tmpdir(), "owx-project-memory-paths-"));
    try {
      await mkdir(join(wd, ".owx"), { recursive: true });
      await writeFile(join(wd, "project-memory.json"), "{}");
      await writeFile(join(wd, ".owx", "project-memory.json"), "{}");

      assert.equal(canonicalProjectMemoryPath(wd), join(wd, "project-memory.json"));
      assert.deepEqual(projectMemoryPathCandidates(wd), [
        join(wd, "project-memory.json"),
        join(wd, ".owx", "project-memory.json"),
      ]);
      assert.equal(resolveProjectMemoryPath(wd), join(wd, "project-memory.json"));
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it("falls back to legacy .owx/project-memory.json when canonical memory is absent", async () => {
    const wd = await mkdtemp(join(tmpdir(), "owx-project-memory-legacy-path-"));
    try {
      await mkdir(join(wd, ".owx"), { recursive: true });
      await writeFile(join(wd, ".owx", "project-memory.json"), "{}");

      assert.equal(resolveProjectMemoryPath(wd), join(wd, ".owx", "project-memory.json"));
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });
});

describe("owxNotepadPath", () => {
  it("uses provided projectRoot", () => {
    assert.equal(owxNotepadPath("/my/project"), join("/my/project", ".owx", "notepad.md"));
  });

  it("defaults to cwd when no projectRoot given", () => {
    assert.equal(owxNotepadPath(), join(process.cwd(), ".owx", "notepad.md"));
  });
});

describe("owxPlansDir", () => {
  it("uses provided projectRoot", () => {
    assert.equal(owxPlansDir("/my/project"), join("/my/project", ".owx", "plans"));
  });

  it("defaults to cwd when no projectRoot given", () => {
    assert.equal(owxPlansDir(), join(process.cwd(), ".owx", "plans"));
  });
});

describe("owxLogsDir", () => {
  it("uses provided projectRoot", () => {
    assert.equal(owxLogsDir("/my/project"), join("/my/project", ".owx", "logs"));
  });

  it("defaults to cwd when no projectRoot given", () => {
    assert.equal(owxLogsDir(), join(process.cwd(), ".owx", "logs"));
  });
});

describe("packageRoot", () => {
  it("resolves to a directory containing package.json", () => {
    const root = packageRoot();
    assert.equal(existsSync(join(root, "package.json")), true);
  });
});

describe("OWX launcher path resolution", () => {
  // Existing launcher files are resolved through realpath before being stored or
  // compared. These assertions intentionally use canonicalized expected paths
  // so macOS /var -> /private/var temp roots and symlinked launch directories
  // exercise the same canonical-realpath contract as production launch context.
  const originalEntryPath = process.env[OWX_ENTRY_PATH_ENV];
  const originalStartupCwd = process.env[OWX_STARTUP_CWD_ENV];

  afterEach(() => {
    if (typeof originalEntryPath === "string") {
      process.env[OWX_ENTRY_PATH_ENV] = originalEntryPath;
    } else {
      delete process.env[OWX_ENTRY_PATH_ENV];
    }
    if (typeof originalStartupCwd === "string") {
      process.env[OWX_STARTUP_CWD_ENV] = originalStartupCwd;
    } else {
      delete process.env[OWX_STARTUP_CWD_ENV];
    }
  });

  it("resolves relative launcher paths against the recorded startup cwd", async () => {
    const startupCwd = await mkdtemp(join(tmpdir(), "owx-launcher-start-"));
    const laterCwd = await mkdtemp(join(tmpdir(), "owx-launcher-later-"));
    try {
      const launcherDir = join(startupCwd, "dist", "cli");
      const launcherPath = join(launcherDir, "owx.js");
      await mkdir(launcherDir, { recursive: true });
      await writeFile(launcherPath, "#!/usr/bin/env node\n", "utf-8");

      const resolved = resolveOmxEntryPath({
        argv1: "dist/cli/owx.js",
        cwd: laterCwd,
        env: {
          ...process.env,
          [OWX_STARTUP_CWD_ENV]: startupCwd,
        },
      });

      assert.equal(resolved, canonicalizeComparablePath(launcherPath));
    } finally {
      await rm(startupCwd, { recursive: true, force: true });
      await rm(laterCwd, { recursive: true, force: true });
    }
  });

  it("canonicalizes symlinked startup cwd launcher paths to their real path", async () => {
    const realRoot = await mkdtemp(join(tmpdir(), "owx-launcher-real-root-"));
    const linkParent = await mkdtemp(join(tmpdir(), "owx-launcher-link-root-"));
    const laterCwd = await mkdtemp(join(tmpdir(), "owx-launcher-symlink-later-"));
    const realStartupCwd = join(realRoot, "project");
    const linkedStartupCwd = join(linkParent, "project-link");
    try {
      const launcherDir = join(realStartupCwd, "dist", "cli");
      const launcherPath = join(launcherDir, "owx.js");
      await mkdir(launcherDir, { recursive: true });
      await writeFile(launcherPath, "#!/usr/bin/env node\n", "utf-8");
      await symlink(
        realStartupCwd,
        linkedStartupCwd,
        process.platform === "win32" ? "junction" : "dir",
      );

      const resolved = resolveOmxEntryPath({
        argv1: "dist/cli/owx.js",
        cwd: laterCwd,
        env: {
          ...process.env,
          [OWX_STARTUP_CWD_ENV]: linkedStartupCwd,
        },
      });

      assert.equal(resolved, await realpath(launcherPath));
      assert.notEqual(resolved, join(linkedStartupCwd, "dist", "cli", "owx.js"));
    } finally {
      await rm(realRoot, { recursive: true, force: true });
      await rm(linkParent, { recursive: true, force: true });
      await rm(laterCwd, { recursive: true, force: true });
    }
  });

  it("records launcher context once so later cwd changes keep the absolute entry path", async () => {
    const startupCwd = await mkdtemp(join(tmpdir(), "owx-launcher-record-"));
    try {
      const launcherDir = join(startupCwd, "dist", "cli");
      const launcherPath = join(launcherDir, "owx.js");
      await mkdir(launcherDir, { recursive: true });
      await writeFile(launcherPath, "#!/usr/bin/env node\n", "utf-8");

      delete process.env[OWX_ENTRY_PATH_ENV];
      delete process.env[OWX_STARTUP_CWD_ENV];
      rememberOmxLaunchContext({
        argv1: "dist/cli/owx.js",
        cwd: startupCwd,
        env: process.env,
      });

      assert.equal(process.env[OWX_STARTUP_CWD_ENV], startupCwd);
      assert.equal(process.env[OWX_ENTRY_PATH_ENV], canonicalizeComparablePath(launcherPath));
    } finally {
      await rm(startupCwd, { recursive: true, force: true });
    }
  });

  it("prefers explicit argv1 over an ambient OWX_ENTRY_PATH override", async () => {
    const startupCwd = await mkdtemp(join(tmpdir(), "owx-launcher-explicit-start-"));
    try {
      const launcherDir = join(startupCwd, "dist", "cli");
      const launcherPath = join(launcherDir, "owx.js");
      await mkdir(launcherDir, { recursive: true });
      await writeFile(launcherPath, "#!/usr/bin/env node\n", "utf-8");

      const resolved = resolveOmxEntryPath({
        argv1: "dist/cli/owx.js",
        cwd: startupCwd,
        env: {
          ...process.env,
          [OWX_ENTRY_PATH_ENV]: "/tmp/ambient-owx.js",
          [OWX_STARTUP_CWD_ENV]: startupCwd,
        },
      });

      assert.equal(resolved, canonicalizeComparablePath(launcherPath));
    } finally {
      await rm(startupCwd, { recursive: true, force: true });
    }
  });

  it("replaces stale ambient OWX_ENTRY_PATH when recording an explicit launcher argv1", async () => {
    const startupCwd = await mkdtemp(join(tmpdir(), "owx-launcher-explicit-record-"));
    const env: NodeJS.ProcessEnv = {
      [OWX_ENTRY_PATH_ENV]: "/opt/homebrew/lib/node_modules/owen-codex/dist/cli/owx.js",
      [OWX_STARTUP_CWD_ENV]: startupCwd,
    };
    try {
      const launcherDir = join(startupCwd, "dist", "cli");
      const launcherPath = join(launcherDir, "owx.js");
      await mkdir(launcherDir, { recursive: true });
      await writeFile(launcherPath, "#!/usr/bin/env node\n", "utf-8");

      rememberOmxLaunchContext({
        argv1: "dist/cli/owx.js",
        cwd: startupCwd,
        env,
      });

      assert.equal(env[OWX_ENTRY_PATH_ENV], canonicalizeComparablePath(launcherPath));
      assert.equal(env[OWX_STARTUP_CWD_ENV], startupCwd);
    } finally {
      await rm(startupCwd, { recursive: true, force: true });
    }
  });

  it("records the default launcher path when called without an explicit argv1", async () => {
    const startupCwd = await mkdtemp(join(tmpdir(), "owx-launcher-default-record-"));
    const originalArgv1 = process.argv[1];
    try {
      const launcherDir = join(startupCwd, "dist", "cli");
      const launcherPath = join(launcherDir, "owx.js");
      await mkdir(launcherDir, { recursive: true });
      await writeFile(launcherPath, "#!/usr/bin/env node\n", "utf-8");

      delete process.env[OWX_ENTRY_PATH_ENV];
      delete process.env[OWX_STARTUP_CWD_ENV];
      process.argv[1] = launcherPath;

      rememberOmxLaunchContext({
        cwd: startupCwd,
        env: process.env,
      });

      assert.equal(process.env[OWX_STARTUP_CWD_ENV], startupCwd);
      assert.equal(process.env[OWX_ENTRY_PATH_ENV], canonicalizeComparablePath(launcherPath));
    } finally {
      process.argv[1] = originalArgv1;
      await rm(startupCwd, { recursive: true, force: true });
    }
  });

  it("falls back to the packaged CLI entry when argv1 points at a non-CLI script", async () => {
    const startupCwd = await mkdtemp(join(tmpdir(), "owx-launcher-cli-fallback-start-"));
    const packageRootDir = await mkdtemp(join(tmpdir(), "owx-launcher-cli-fallback-root-"));
    try {
      const hookDir = join(startupCwd, "dist", "scripts");
      const hookPath = join(hookDir, "codex-native-hook.js");
      const cliDir = join(packageRootDir, "dist", "cli");
      const cliPath = join(cliDir, "owx.js");
      await mkdir(hookDir, { recursive: true });
      await mkdir(cliDir, { recursive: true });
      await writeFile(hookPath, "#!/usr/bin/env node\n", "utf-8");
      await writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");

      const resolved = resolveOmxCliEntryPath({
        argv1: "dist/scripts/codex-native-hook.js",
        cwd: startupCwd,
        env: {
          ...process.env,
          [OWX_STARTUP_CWD_ENV]: startupCwd,
        },
        packageRootDir,
      });

      assert.equal(resolved, canonicalizeComparablePath(cliPath));
    } finally {
      await rm(startupCwd, { recursive: true, force: true });
      await rm(packageRootDir, { recursive: true, force: true });
    }
  });

  it("keeps the resolved path when argv1 already points at the CLI entry", async () => {
    const startupCwd = await mkdtemp(join(tmpdir(), "owx-launcher-cli-direct-start-"));
    try {
      const cliDir = join(startupCwd, "dist", "cli");
      const cliPath = join(cliDir, "owx.js");
      await mkdir(cliDir, { recursive: true });
      await writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");

      const resolved = resolveOmxCliEntryPath({
        argv1: "dist/cli/owx.js",
        cwd: startupCwd,
        env: {
          ...process.env,
          [OWX_STARTUP_CWD_ENV]: startupCwd,
        },
      });

      assert.equal(resolved, canonicalizeComparablePath(cliPath));
    } finally {
      await rm(startupCwd, { recursive: true, force: true });
    }
  });

  it("falls back from a non-OWX host binary to the packaged CLI entry", async () => {
    const startupCwd = await mkdtemp(join(tmpdir(), "owx-launcher-cli-host-start-"));
    const packageRootDir = await mkdtemp(join(tmpdir(), "owx-launcher-cli-host-root-"));
    try {
      const hostPath = join(startupCwd, "codex-host");
      const cliDir = join(packageRootDir, "dist", "cli");
      const cliPath = join(cliDir, "owx.js");
      await writeFile(hostPath, "#!/usr/bin/env node\n", "utf-8");
      await mkdir(cliDir, { recursive: true });
      await writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");

      const resolved = resolveOmxCliEntryPath({
        argv1: hostPath,
        cwd: startupCwd,
        env: {
          ...process.env,
          [OWX_STARTUP_CWD_ENV]: startupCwd,
        },
        packageRootDir,
      });

      assert.equal(resolved, canonicalizeComparablePath(cliPath));
    } finally {
      await rm(startupCwd, { recursive: true, force: true });
      await rm(packageRootDir, { recursive: true, force: true });
    }
  });

});
