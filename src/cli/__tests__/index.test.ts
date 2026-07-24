import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HELP,
  assertSupportedDoctorOptions,
  assertSupportedSetupOptions,
  classifyCodexExecFailure,
  commandOwnsLocalHelp,
  injectModelInstructionsBypassArgs,
  normalizeCodexLaunchArgs,
  resolveCliInvocation,
  resolveSetupInstallModeArg,
  resolveSetupMcpModeArg,
  resolveSetupScopeArg,
  resolveSignalExitCode,
  resolveUpdateChannelArg,
  sanitizeDirectCodexEnv,
} from "../index.js";

describe("central CLI routing", () => {
  it("routes no arguments and Codex flags to direct launch", () => {
    assert.deepEqual(resolveCliInvocation([]), { command: "launch", launchArgs: [] });
    assert.deepEqual(resolveCliInvocation(["--model", "gpt-5"]), {
      command: "launch",
      launchArgs: ["--model", "gpt-5"],
    });
  });

  it("routes retained commands without exposing removed runtime commands", () => {
    assert.deepEqual(resolveCliInvocation(["exec", "--json"]), {
      command: "exec",
      launchArgs: ["--json"],
    });
    assert.equal(commandOwnsLocalHelp("setup"), true);
    const removedCommands = ["te" + "am", "ques" + "tion", "side" + "car", "tm" + "ux-hook"];
    for (const removed of removedCommands) {
      assert.doesNotMatch(HELP, new RegExp(`\\bowx\\s+${removed}\\b`, "i"));
    }
    assert.match(HELP, /\bowx hud\b/i);
    assert.doesNotMatch(HELP, new RegExp(["detached ", "tm", "ux|--", "tm", "ux"].join(""), "i"));
    assert.deepEqual(
      sanitizeDirectCodexEnv({ TERMINAL_CONTEXT: "stale", KEEP: "yes" }),
      { TERMINAL_CONTEXT: "stale", KEEP: "yes" },
    );
  });
});

describe("setup option parsing", () => {
  it("parses current scope, install, and MCP options", () => {
    const args = ["--scope", "project", "--install-mode=plugin", "--mcp", "compat"];
    assert.equal(resolveSetupScopeArg(args), "project");
    assert.equal(resolveSetupInstallModeArg(args), "plugin");
    assert.equal(resolveSetupMcpModeArg(args), "compat");
    assert.doesNotThrow(() => assertSupportedSetupOptions(args));
  });

  it("rejects removed or unknown options", () => {
    assert.throws(() => assertSupportedSetupOptions(["--team-mode=enabled"]), /unknown setup option/);
    assert.throws(() => assertSupportedDoctorOptions(["--team"]), /unknown doctor option/);
  });
});

describe("direct Codex argument normalization", () => {
  it("maps OWX reasoning and bypass aliases onto Codex arguments", () => {
    assert.deepEqual(normalizeCodexLaunchArgs(["--madmax", "--high", "resume"]), [
      "resume",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      'model_reasoning_effort="high"',
    ]);
  });

  it("treats --direct as a compatibility no-op and rejects removed launch surfaces", () => {
    assert.deepEqual(normalizeCodexLaunchArgs(["--direct", "resume"]), ["resume"]);
    for (const option of [["--tm", "ux"].join(""), "--spark", "--madmax-spark", "--worktree"]) {
      assert.throws(() => normalizeCodexLaunchArgs([option]), /removed OWX launch option/);
    }
  });

  it("injects the session instructions file unless explicitly overridden", () => {
    assert.deepEqual(
      injectModelInstructionsBypassArgs("/repo", ["resume"], {}, "/tmp/session.md"),
      ["resume", "-c", 'model_instructions_file="/tmp/session.md"'],
    );
    assert.deepEqual(
      injectModelInstructionsBypassArgs("/repo", ["-c", 'model_instructions_file="custom.md"'], {}),
      ["-c", 'model_instructions_file="custom.md"'],
    );
  });
});

describe("stable helpers", () => {
  it("parses update channels", () => {
    assert.equal(resolveUpdateChannelArg([]), "stable");
    assert.equal(resolveUpdateChannelArg(["--dev"]), "dev");
    assert.throws(() => resolveUpdateChannelArg(["--stable", "--dev"]), /mutually exclusive/);
  });

  it("classifies Codex exits and signals", () => {
    assert.equal(resolveSignalExitCode("SIGTERM"), 143);
    assert.deepEqual(classifyCodexExecFailure({ status: 7, message: "exit" }), {
      kind: "exit",
      code: undefined,
      message: "exit",
      exitCode: 7,
      signal: undefined,
    });
  });
});
