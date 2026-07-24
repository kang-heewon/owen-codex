/** owen-codex CLI entrypoint. */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { constants as osConstants } from "node:os";
import {
  setup,
  SETUP_MCP_MODES,
  SETUP_SCOPES,
  type SetupInstallMode,
  type SetupMcpMode,
  type SetupScope,
} from "./setup.js";
import { uninstall } from "./uninstall.js";
import { version } from "./version.js";
import { hooksCommand } from "./hooks.js";
import { hudCommand } from "../hud/index.js";
import { ralphCommand } from "./ralph.js";
import { ultragoalCommand } from "./ultragoal.js";
import { performanceGoalCommand } from "./performance-goal.js";
import { askCommand } from "./ask.js";
import { stateCommand } from "./state.js";
import { cleanupCommand } from "./cleanup.js";
import { exploreCommand } from "./explore.js";
import { sparkshellCommand } from "./sparkshell.js";
import { apiCommand } from "./api.js";
import { agentsInitCommand } from "./agents-init.js";
import { agentsCommand } from "./agents.js";
import { sessionCommand } from "./session-search.js";
import { autoresearchCommand } from "./autoresearch.js";
import { autoresearchGoalCommand } from "./autoresearch-goal.js";
import { mcpParityCommand } from "./mcp-parity.js";
import { mcpServeCommand } from "./mcp-serve.js";
import { adaptCommand } from "./adapt.js";
import { listCommand } from "./list.js";
import { surfaceCommand } from "./surface.js";
import { authCommand } from "./auth.js";
import { runAuthHotswap } from "../auth/hotswap.js";
import {
  CODEX_BYPASS_FLAG,
  CONFIG_FLAG,
  HIGH_REASONING_FLAG,
  LONG_CONFIG_FLAG,
  MADMAX_FLAG,
  XHIGH_REASONING_FLAG,
} from "./constants.js";
import {
  readPersistedSetupPreferences,
  resolveCodexConfigPathForLaunch,
  resolveCodexHomeForLaunch,
} from "./codex-home.js";
import { runImmediateUpdate, type UpdateChannel } from "./update.js";
import {
  generateOverlay,
  removeSessionModelInstructionsFile,
  sessionModelInstructionsPath,
  writeSessionModelInstructionsFile,
} from "../hooks/agents-overlay.js";
import { escapeTomlString, readTopLevelTomlString, upsertTopLevelTomlString } from "../utils/toml.js";
import { getPackageRoot } from "../utils/package.js";
import { codexConfigPath } from "../utils/paths.js";
import {
  extractSharedMcpRegistryServersFromConfig,
  repairConfigIfNeeded,
} from "../config/generator.js";
import type { UnifiedMcpRegistryServer } from "../config/mcp-registry.js";
import { OWX_FIRST_PARTY_MCP_SERVER_NAMES } from "../config/owx-first-party-mcp.js";
import { classifySpawnError, spawnPlatformCommandSync } from "../utils/platform-command.js";
import {
  OWX_NOTIFY_TEMP_CONTRACT_ENV,
  parseNotifyTempContractFromArgs,
  serializeNotifyTempContract,
  type ParseNotifyTempContractResult,
} from "../notifications/temp-contract.js";
import { execInjectCommand } from "../exec/followup.js";
import { imagegenCommand } from "../imagegen/continuation.js";
import { listModeStateFilesWithScopePreference } from "../mcp/state-paths.js";

export {
  readPersistedSetupPreferences,
  readPersistedSetupScope,
  resolveCodexConfigPathForLaunch,
  resolveCodexHomeForLaunch,
  resolveProjectLocalCodexHomeForLaunch,
} from "./codex-home.js";
export { readTopLevelTomlString, upsertTopLevelTomlString } from "../utils/toml.js";

const REASONING_KEY = "model_reasoning_effort";
const MODEL_INSTRUCTIONS_FILE_KEY = "model_instructions_file";
const OWX_BYPASS_DEFAULT_SYSTEM_PROMPT_ENV = "OWX_BYPASS_DEFAULT_SYSTEM_PROMPT";
const OWX_MODEL_INSTRUCTIONS_FILE_ENV = "OWX_MODEL_INSTRUCTIONS_FILE";
const REASONING_MODES = ["low", "medium", "high", "xhigh"] as const;
type ReasoningMode = (typeof REASONING_MODES)[number];
const REASONING_MODE_SET = new Set<string>(REASONING_MODES);
const REASONING_USAGE = "Usage: owx reasoning <low|medium|high|xhigh>";
const REMOVED_TERMINAL_LAUNCH_FLAG = ["--tm", "ux"].join("");

const NESTED_HELP_COMMANDS = new Set<string>([
  "setup",
  "update",
  "list",
  "surface",
  "agents",
  "agents-init",
  "deepinit",
  "uninstall",
  "doctor",
  "cleanup",
  "auth",
  "ask",
  "adapt",
  "autoresearch",
  "autoresearch-goal",
  "explore",
  "api",
  "sparkshell",
  "ralph",
  "ultragoal",
  "performance-goal",
  "session",
  "resume",
  "hooks",
  "state",
  "mcp-serve",
  "exec",
  "imagegen",
  "hud",
]);

export const HELP = `
owen-codex (owx) - OpenAI Codex workflow tooling

Usage:
  owx           Launch Codex CLI directly in the current terminal
  owx launch    Launch Codex CLI directly
  owx exec      Run codex exec non-interactively with OWX overlay injection
  owx imagegen  Queue built-in image generation continuations
  owx setup     Install skills, prompts, config, and AGENTS.md
  owx update    Install stable (or --dev), then refresh setup
  owx uninstall Remove OWX configuration and installed artifacts
  owx doctor    Check installation health
  owx list      List packaged skills and native agent prompts
  owx surface   Inspect the public product surface
  owx cleanup   Remove stale OWX processes and temporary directories
  owx ask       Ask a local provider CLI
  owx auth      Manage Codex OAuth auth slots
  owx adapt     Scaffold OWX-owned adapter foundations for persistent external targets
  owx api       Run native owx-api localhost gateway commands (serve|status|stop|generate)
  owx autoresearch
                [DEPRECATED] Use $autoresearch; direct CLI launch removed
  owx autoresearch-goal
                Run durable professor-critic research goals
  owx explore   Deprecated compatibility command; use normal repository inspection
  owx sparkshell <command> [args...]
                Run a command directly with optional native summarization
  owx session   Search prior local session transcripts and history artifacts
  owx resume    Resume a previous interactive Codex session
  owx agents    Manage Codex native agent TOML files
  owx agents-init [path]
                Bootstrap lightweight AGENTS.md files
  owx deepinit [path]
                Alias for agents-init
  owx ralph     Run the retained Ralph workflow
  owx ultragoal Run durable goal workflows
  owx performance-goal
                Run evaluator-backed performance goals
  owx hooks     Manage native hooks
  owx hud       Show the retained HUD statusline
  owx state     Inspect retained workflow state
  owx notepad   Access notepad state through the JSON CLI
  owx project-memory
                Access project memory through the JSON CLI
  owx trace     Access trace state through the JSON CLI
  owx code-intel
                Access code intelligence through the JSON CLI
  owx wiki      Access project wiki state through the JSON CLI
  owx mcp-serve Serve a retained MCP compatibility target
  owx status    Show retained workflow status
  owx cancel    Cancel active retained workflows
  owx reasoning <low|medium|high|xhigh>
  owx help      Show this help
  owx version   Show version

Launch flags:
  --hotswap     Enable configured Codex auth-slot rotation
  --madmax      Alias for Codex bypass approvals/sandbox mode
  --high        Set model_reasoning_effort=\"high\"
  --xhigh       Set model_reasoning_effort=\"xhigh\"
`;

export interface ResolvedCliInvocation {
  command: string;
  launchArgs: string[];
}

export function resolveSetupInstallModeArg(args: string[]): SetupInstallMode | undefined {
  let value: SetupInstallMode | undefined;
  const setValue = (next: SetupInstallMode, source: string): void => {
    if (value && value !== next) {
      throw new Error(
        `Conflicting setup install mode flags: ${source} selects ${next}, but another flag already selected ${value}`,
      );
    }
    value = next;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--plugin") {
      setValue("plugin", arg);
    } else if (arg === "--legacy") {
      setValue("legacy", arg);
    } else if (arg === "--install-mode") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(
          "Missing setup install mode value after --install-mode. Expected one of: legacy, plugin",
        );
      }
      if (next !== "legacy" && next !== "plugin") {
        throw new Error(
          `Invalid setup install mode: ${next}. Expected one of: legacy, plugin`,
        );
      }
      setValue(next, arg);
      index += 1;
    } else if (arg.startsWith("--install-mode=")) {
      const next = arg.slice("--install-mode=".length);
      if (next !== "legacy" && next !== "plugin") {
        throw new Error(
          `Invalid setup install mode: ${next}. Expected one of: legacy, plugin`,
        );
      }
      setValue(next, "--install-mode");
    }
  }
  return value;
}

export function resolveSetupMcpModeArg(args: string[]): SetupMcpMode | undefined {
  let value: SetupMcpMode | undefined;
  const setValue = (next: SetupMcpMode, source: string): void => {
    if (value && value !== next) {
      throw new Error(
        `Conflicting setup MCP mode flags: ${source} selects ${next}, but another flag already selected ${value}`,
      );
    }
    value = next;
  };
  const parseValue = (next: string): SetupMcpMode => {
    if (!SETUP_MCP_MODES.includes(next as SetupMcpMode)) {
      throw new Error(
        `Invalid setup MCP mode: ${next}. Expected one of: none, compat`,
      );
    }
    return next as SetupMcpMode;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-mcp") {
      setValue("none", arg);
    } else if (arg === "--with-mcp") {
      setValue("compat", arg);
    } else if (arg === "--mcp") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(
          "Missing setup MCP mode value after --mcp. Expected one of: none, compat",
        );
      }
      setValue(parseValue(next), arg);
      index += 1;
    } else if (arg.startsWith("--mcp=")) {
      setValue(parseValue(arg.slice("--mcp=".length)), "--mcp");
    }
  }
  return value;
}

export function resolveSetupScopeArg(args: string[]): SetupScope | undefined {
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--scope") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(
          `Missing setup scope value after --scope. Expected one of: ${SETUP_SCOPES.join(", ")}`,
        );
      }
      value = next;
      index += 1;
    } else if (arg.startsWith("--scope=")) {
      value = arg.slice("--scope=".length);
    }
  }
  if (!value) return undefined;
  if (SETUP_SCOPES.includes(value as SetupScope)) return value as SetupScope;
  throw new Error(`Invalid setup scope: ${value}. Expected one of: ${SETUP_SCOPES.join(", ")}`);
}

export function assertSupportedSetupOptions(args: string[]): void {
  const withValues = new Set(["--scope", "--install-mode", "--mcp"]);
  const standalone = new Set([
    "--force",
    "--merge-agents",
    "--dry-run",
    "--verbose",
    "--plugin",
    "--legacy",
    "--no-mcp",
    "--with-mcp",
  ]);
  const prefixes = ["--scope=", "--install-mode=", "--mcp="];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (withValues.has(arg)) {
      index += 1;
      continue;
    }
    if (standalone.has(arg) || prefixes.some((prefix) => arg.startsWith(prefix))) continue;
    if (arg.startsWith("-")) throw new Error(`unknown setup option: ${arg}`);
  }
}

export function assertSupportedDoctorOptions(args: string[]): void {
  const supported = new Set(["--verbose", "--force", "--dry-run"]);
  const unknown = args.find((arg) => arg.startsWith("-") && !supported.has(arg));
  if (unknown) throw new Error(`unknown doctor option: ${unknown}`);
}

export function resolveCliInvocation(args: string[]): ResolvedCliInvocation {
  const firstArg = args[0];
  if (firstArg === "--help" || firstArg === "-h") {
    return { command: "help", launchArgs: [] };
  }
  if (firstArg === "--version" || firstArg === "-v") {
    return { command: "version", launchArgs: [] };
  }
  if (!firstArg || firstArg.startsWith("--")) {
    return { command: "launch", launchArgs: firstArg ? args : [] };
  }
  if (firstArg === "launch") return { command: "launch", launchArgs: args.slice(1) };
  if (firstArg === "exec") return { command: "exec", launchArgs: args.slice(1) };
  if (firstArg === "resume") return { command: "resume", launchArgs: args.slice(1) };
  return { command: firstArg, launchArgs: [] };
}

export function resolveUpdateChannelArg(args: string[]): UpdateChannel {
  let channel: UpdateChannel = "stable";
  let sawStable = false;
  let sawDev = false;
  for (const arg of args) {
    if (arg === "--stable") {
      sawStable = true;
      channel = "stable";
    } else if (arg === "--dev") {
      sawDev = true;
      channel = "dev";
    } else {
      throw new Error(
        `Unknown owx update option: ${arg}. Expected no flags, --stable, or --dev.`,
      );
    }
  }
  if (sawStable && sawDev) throw new Error("owx update --dev and --stable are mutually exclusive.");
  return channel;
}

export function resolveNotifyTempContract(args: string[], env: NodeJS.ProcessEnv = process.env): ParseNotifyTempContractResult {
  return parseNotifyTempContractFromArgs(args, env);
}

export function commandOwnsLocalHelp(command: string): boolean {
  return NESTED_HELP_COMMANDS.has(command);
}

export interface CodexExecFailureClassification {
  kind: "exit" | "launch-error";
  code?: string;
  message: string;
  exitCode?: number;
  signal?: NodeJS.Signals;
}

type ExecFileSyncFailure = NodeJS.ErrnoException & { status?: number; signal?: NodeJS.Signals };

export function resolveSignalExitCode(signal: NodeJS.Signals | null | undefined): number {
  if (!signal) return 1;
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === "number" && Number.isFinite(signalNumber) ? 128 + signalNumber : 1;
}

export function classifyCodexExecFailure(error: unknown): CodexExecFailureClassification {
  if (!error || typeof error !== "object") {
    return { kind: "launch-error", message: String(error) };
  }
  const err = error as ExecFileSyncFailure;
  const code = typeof err.code === "string" ? err.code : undefined;
  const message = typeof err.message === "string" && err.message ? err.message : "unknown codex launch failure";
  if (typeof err.status === "number" || typeof err.signal === "string") {
    return {
      kind: "exit",
      code,
      message,
      exitCode:
        typeof err.status === "number"
          ? err.status
          : resolveSignalExitCode(err.signal),
      signal: err.signal,
    };
  }
  return { kind: "launch-error", code, message };
}

export async function resolveLaunchConfigRepairOptions(cwd: string, configPath: string): Promise<{
  includeFirstPartyMcp: boolean;
  sharedMcpServers?: UnifiedMcpRegistryServer[];
  sharedMcpRegistrySource?: string;
}> {
  const content = existsSync(configPath) ? await readFile(configPath, "utf-8") : undefined;
  const shared = content ? extractSharedMcpRegistryServersFromConfig(content) : { servers: [] };
  const sharedOptions = shared.servers.length > 0
    ? {
        sharedMcpServers: shared.servers,
        sharedMcpRegistrySource: shared.sourcePath,
      }
    : {};
  if (readPersistedSetupPreferences(cwd)?.mcpMode === "compat") {
    return { includeFirstPartyMcp: true, ...sharedOptions };
  }
  const hasFirstParty = content
    ? OWX_FIRST_PARTY_MCP_SERVER_NAMES.some((name) =>
        new RegExp(`^\\s*\\[mcp_servers\\.${name}\\]\\s*$`, "m").test(content),
      )
    : false;
  return { includeFirstPartyMcp: hasFirstParty, ...sharedOptions };
}

export function normalizeCodexLaunchArgs(args: string[]): string[] {
  const normalized: string[] = [];
  let wantsBypass = false;
  let hasBypass = false;
  let reasoning: ReasoningMode | null = null;
  for (const arg of args) {
    if (arg === "--direct") continue;
    if (
      arg === REMOVED_TERMINAL_LAUNCH_FLAG ||
      arg === "--spark" ||
      arg === "--madmax-spark" ||
      arg === "--worktree" ||
      arg.startsWith("--worktree=")
    ) {
      throw new Error(`removed OWX launch option: ${arg}`);
    }
    if (arg === MADMAX_FLAG) {
      wantsBypass = true;
      continue;
    }
    if (arg === CODEX_BYPASS_FLAG) {
      wantsBypass = true;
      if (!hasBypass) {
        normalized.push(arg);
        hasBypass = true;
      }
      continue;
    }
    if (arg === HIGH_REASONING_FLAG) {
      reasoning = "high";
      continue;
    }
    if (arg === XHIGH_REASONING_FLAG) {
      reasoning = "xhigh";
      continue;
    }
    normalized.push(arg);
  }
  if (wantsBypass && !hasBypass) normalized.push(CODEX_BYPASS_FLAG);
  if (reasoning) normalized.push(CONFIG_FLAG, `${REASONING_KEY}=\"${reasoning}\"`);
  return normalized;
}

function isModelInstructionsOverride(value: string): boolean {
  return new RegExp(`^${MODEL_INSTRUCTIONS_FILE_KEY}\\s*=`).test(value.trim());
}

function hasModelInstructionsOverride(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (
      (arg === CONFIG_FLAG || arg === LONG_CONFIG_FLAG) &&
      isModelInstructionsOverride(args[index + 1] ?? "")
    ) {
      return true;
    }
    if (
      arg.startsWith(`${LONG_CONFIG_FLAG}=`) &&
      isModelInstructionsOverride(arg.slice(`${LONG_CONFIG_FLAG}=`.length))
    ) {
      return true;
    }
  }
  return false;
}

export function injectModelInstructionsBypassArgs(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  defaultFilePath?: string,
): string[] {
  if (
    env[OWX_BYPASS_DEFAULT_SYSTEM_PROMPT_ENV] === "0" ||
    hasModelInstructionsOverride(args)
  ) {
    return [...args];
  }
  const filePath = env[OWX_MODEL_INSTRUCTIONS_FILE_ENV] || defaultFilePath || join(cwd, "AGENTS.md");
  return [...args, CONFIG_FLAG, `${MODEL_INSTRUCTIONS_FILE_KEY}=\"${escapeTomlString(filePath)}\"`];
}

async function repairLaunchConfig(cwd: string): Promise<void> {
  try {
    const configPath = resolveCodexConfigPathForLaunch(cwd, process.env);
    const repaired = await repairConfigIfNeeded(
      configPath,
      getPackageRoot(),
      await resolveLaunchConfigRepairOptions(cwd, configPath),
    );
    if (repaired) console.log("[owx] Repaired managed config.toml compatibility issue.");
  } catch {
    // Config repair remains best effort and never blocks Codex.
  }
}

async function prepareDirectOverlay(cwd: string, sessionId: string): Promise<string> {
  const overlay = await generateOverlay(cwd, sessionId);
  return writeSessionModelInstructionsFile(cwd, sessionId, overlay);
}

function runCodexBlocking(cwd: string, args: string[], env: NodeJS.ProcessEnv): void {
  const { result } = spawnPlatformCommandSync("codex", args, {
    cwd,
    stdio: "inherit",
    env,
    encoding: "utf-8",
  });
  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    const kind = classifySpawnError(error);
    if (kind === "missing") {
      console.error("[owx] failed to launch codex: executable not found in PATH");
    } else if (kind === "blocked") {
      console.error(
        `[owx] failed to launch codex: executable is blocked (${error.code || "blocked"})`,
      );
    } else {
      console.error(`[owx] failed to launch codex: ${error.message}`);
    }
    throw error;
  }
  if (result.status !== 0) {
    process.exitCode = typeof result.status === "number" ? result.status : resolveSignalExitCode(result.signal);
  }
}

export function sanitizeDirectCodexEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...source };
}

async function runDirectCodex(rawArgs: string[], execMode = false): Promise<void> {
  const cwd = process.cwd();
  const sessionId = `owx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const notify = resolveNotifyTempContract(rawArgs, process.env);
  for (const warning of notify.contract.warnings) console.warn(`[owx] ${warning}`);
  const normalized = normalizeCodexLaunchArgs(notify.passthroughArgs);
  await repairLaunchConfig(cwd);
  const instructionsPath = await prepareDirectOverlay(cwd, sessionId);
  const codexHome = resolveCodexHomeForLaunch(cwd, process.env);
  const env = {
    ...sanitizeDirectCodexEnv(process.env),
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
    [OWX_NOTIFY_TEMP_CONTRACT_ENV]: serializeNotifyTempContract(notify.contract),
  };
  try {
    const args = injectModelInstructionsBypassArgs(
      cwd,
      execMode ? ["exec", ...normalized] : normalized,
      env,
      instructionsPath,
    );
    runCodexBlocking(cwd, args, env);
  } finally {
    await removeSessionModelInstructionsFile(cwd, sessionId).catch(() => undefined);
  }
}

export async function launchDirectly(args: string[]): Promise<void> {
  await runDirectCodex(args);
}

export async function execWithOverlay(args: string[]): Promise<void> {
  await runDirectCodex(args, true);
}

export async function launchWithAuthHotswap(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const env = sanitizeDirectCodexEnv(process.env);
  const status = await runAuthHotswap({
    cwd,
    env,
    argv: args,
    lifecycle: {
      prepareCodexHomeForLaunch: async (launchCwd, _sessionId, env) => ({
        codexHomeOverride: resolveCodexHomeForLaunch(launchCwd, env),
      }),
      preLaunch: async (launchCwd, sessionId) => {
        await prepareDirectOverlay(launchCwd, sessionId);
      },
      postLaunch: async (launchCwd, sessionId) => {
        await removeSessionModelInstructionsFile(launchCwd, sessionId);
      },
      cleanupRuntimeCodexHome: async () => undefined,
      normalizeCodexLaunchArgs,
      injectModelInstructionsBypassArgs,
      sessionModelInstructionsPath,
      resolveOmxRootForLaunch: (_launchCwd, launchEnv) => launchEnv.OWX_ROOT?.trim() || undefined,
      resolveNotifyTempContract,
    },
  });
  process.exitCode = status;
}

async function showStatus(): Promise<void> {
  const refs = await listModeStateFilesWithScopePreference(process.cwd());
  if (refs.length === 0) {
    console.log("No active modes.");
    return;
  }
  for (const ref of refs) {
    try {
      const state = JSON.parse(await readFile(ref.path, "utf-8")) as Record<string, unknown>;
      console.log(
        `${ref.mode}: ${state.active === true ? "ACTIVE" : "inactive"} (phase: ${String(state.current_phase || "n/a")})`,
      );
    } catch {
      // Ignore stale or partially written state files.
    }
  }
}

async function cancelModes(): Promise<void> {
  const refs = await listModeStateFilesWithScopePreference(process.cwd());
  let cancelled = 0;
  for (const ref of refs) {
    try {
      const state = JSON.parse(await readFile(ref.path, "utf-8")) as Record<string, unknown>;
      if (state.active !== true) continue;
      state.active = false;
      state.current_phase = "cancelled";
      state.completed_at = new Date().toISOString();
      await writeFile(ref.path, JSON.stringify(state, null, 2));
      console.log(`Cancelled: ${ref.mode}`);
      cancelled += 1;
    } catch {
      // Ignore stale or partially written state files.
    }
  }
  if (cancelled === 0) console.log("No active modes to cancel.");
}

async function reasoningCommand(args: string[]): Promise<void> {
  const mode = args[0];
  const configPath = codexConfigPath();
  if (!mode) {
    if (!existsSync(configPath)) {
      console.log(`model_reasoning_effort is not set (${configPath} does not exist).`);
      console.log(REASONING_USAGE);
      return;
    }
    const current = readTopLevelTomlString(
      await readFile(configPath, "utf-8"),
      REASONING_KEY,
    );
    console.log(
      current
        ? `Current ${REASONING_KEY}: ${current}`
        : `${REASONING_KEY} is not set in ${configPath}.`,
    );
    return;
  }
  if (!REASONING_MODE_SET.has(mode)) {
    throw new Error(
      `Invalid reasoning mode \"${mode}\". Expected one of: ${REASONING_MODES.join(", ")}.\n${REASONING_USAGE}`,
    );
  }
  await mkdir(dirname(configPath), { recursive: true });
  const existing = existsSync(configPath) ? await readFile(configPath, "utf-8") : "";
  await writeFile(configPath, upsertTopLevelTomlString(existing, REASONING_KEY, mode));
  console.log(`Set ${REASONING_KEY}=\"${mode}\" in ${configPath}`);
}

export async function main(args: string[]): Promise<void> {
  const firstArg = args[0];
  const { command, launchArgs } = resolveCliInvocation(args);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const options = {
    force: flags.has("--force"),
    mergeAgents: flags.has("--merge-agents"),
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
  };
  if (flags.has("--help") && !commandOwnsLocalHelp(command)) {
    console.log(HELP);
    return;
  }
  try {
    switch (command) {
      case "launch":
        if (launchArgs.includes("--hotswap")) {
          await launchWithAuthHotswap(launchArgs);
        } else {
          await launchDirectly(launchArgs);
        }
        break;
      case "resume":
        await launchDirectly(["resume", ...launchArgs]);
        break;
      case "exec":
        if (launchArgs[0] === "inject") {
          await execInjectCommand(launchArgs);
        } else {
          await execWithOverlay(launchArgs);
        }
        break;
      case "setup":
        assertSupportedSetupOptions(args.slice(1));
        await setup({
          ...options,
          scope: resolveSetupScopeArg(args.slice(1)),
          installMode: resolveSetupInstallModeArg(args.slice(1)),
          mcpMode: resolveSetupMcpModeArg(args.slice(1)),
        });
        break;
      case "update":
        await runImmediateUpdate(process.cwd(), {}, {
          channel: resolveUpdateChannelArg(args.slice(1)),
        });
        break;
      case "list":
        await listCommand(args.slice(1));
        break;
      case "surface":
        await surfaceCommand(args.slice(1), HELP);
        break;
      case "agents":
        await agentsCommand(args.slice(1));
        break;
      case "agents-init":
      case "deepinit":
        await agentsInitCommand(args.slice(1));
        break;
      case "uninstall":
        await uninstall({
          dryRun: options.dryRun,
          keepConfig: flags.has("--keep-config"),
          verbose: options.verbose,
          purge: flags.has("--purge"),
          scope: resolveSetupScopeArg(args.slice(1)),
        });
        break;
      case "doctor": {
        assertSupportedDoctorOptions(args.slice(1));
        const { doctor } = await import("./doctor.js");
        await doctor(options);
        break;
      }
      case "cleanup":
        await cleanupCommand(args.slice(1));
        break;
      case "auth":
        await authCommand(args.slice(1));
        break;
      case "ask":
        await askCommand(args.slice(1));
        break;
      case "adapt":
        await adaptCommand(args.slice(1));
        break;
      case "autoresearch":
        await autoresearchCommand(args.slice(1));
        break;
      case "autoresearch-goal":
        await autoresearchGoalCommand(args.slice(1));
        break;
      case "explore":
        await exploreCommand(args.slice(1));
        break;
      case "api":
        await apiCommand(args.slice(1));
        break;
      case "imagegen":
        await imagegenCommand(args.slice(1));
        break;
      case "sparkshell":
        await sparkshellCommand(args.slice(1));
        break;
      case "session":
        await sessionCommand(args.slice(1));
        break;
      case "ralph":
        await ralphCommand(args.slice(1));
        break;
      case "ultragoal":
        await ultragoalCommand(args.slice(1));
        break;
      case "performance-goal":
        await performanceGoalCommand(args.slice(1));
        break;
      case "state":
        await stateCommand(args.slice(1));
        break;
      case "notepad":
      case "project-memory":
      case "trace":
      case "code-intel":
      case "wiki":
        await mcpParityCommand(command, args.slice(1));
        break;
      case "mcp-serve":
        await mcpServeCommand(args.slice(1));
        break;
      case "hooks":
        await hooksCommand(args.slice(1));
        break;
      case "hud":
        await hudCommand(args.slice(1));
        break;
      case "status":
        await showStatus();
        break;
      case "cancel":
        await cancelModes();
        break;
      case "reasoning":
        await reasoningCommand(args.slice(1));
        break;
      case "codex-native-hook": {
        const { runCodexNativeHookCli } = await import(
          "../scripts/codex-native-hook.js"
        );
        await runCodexNativeHookCli();
        break;
      }
      case "version":
        version();
        break;
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        break;
      default:
        if (firstArg?.startsWith("-")) await launchDirectly(args);
        else {
          console.error(`Unknown command: ${command}`);
          console.log(HELP);
          process.exitCode = 1;
        }
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
