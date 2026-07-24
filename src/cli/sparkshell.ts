import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from 'child_process';
import { existsSync } from 'fs';
import { arch as osArch, constants as osConstants } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { getPackageRoot } from '../utils/package.js';
import { classifySpawnError } from '../utils/platform-command.js';
import { readConfiguredEnvOverrides } from '../config/models.js';
import {
  SPARKSHELL_BIN_ENV as SPARKSHELL_BIN_ENV_SHARED,
  getPackageVersion,
  hydrateNativeBinary,
  resolveLinuxNativeLibcPreference,
  resolveCachedNativeBinaryCandidatePaths,
} from './native-assets.js';

const OWX_SPARKSHELL_BIN_ENV = SPARKSHELL_BIN_ENV_SHARED;
const OWX_SPARKSHELL_INSTRUCTIONS_FILE_ENV = 'OWX_SPARKSHELL_MODEL_INSTRUCTIONS_FILE';

export const SPARKSHELL_USAGE = [
  'Usage: owx sparkshell <command> [args...]',
  '   or: owx sparkshell [--json] [--budget <chars>] <command> [args...]',
  '   or: owx sparkshell --shell \'<shell command>\'',
  'Runs the native owx-sparkshell helper with direct argv execution or explicit shell execution.',
  'Shell metacharacters are interpreted only with explicit --shell opt-in.',
  'Environment: OWX_SPARKSHELL_BIN overrides the native binary; OWX_SPARKSHELL_MODEL selects the summary model; OWX_SPARKSHELL_FALLBACK_MODEL selects the retry model.',
  'Environment: OWX_SPARKSHELL_MODEL_INSTRUCTIONS_FILE overrides packaged summary instructions; OWX_SPARKSHELL_SUMMARY_TIMEOUT_MS controls local API summary timeout.',
].join('\n');

export interface ResolveSparkShellBinaryPathOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  packageRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  linuxLibcPreference?: readonly ('musl' | 'glibc')[];
  exists?: (path: string) => boolean;
}

export interface RunSparkShellBinaryOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawnSync;
}

function resolveSignalExitCode(signal: NodeJS.Signals | null): number {
  if (!signal) return 1;
  const signalNumber = osConstants.signals[signal];
  if (typeof signalNumber === 'number' && Number.isFinite(signalNumber)) {
    return 128 + signalNumber;
  }
  return 1;
}

export function sparkshellBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'owx-sparkshell.exe' : 'owx-sparkshell';
}

export function packagedSparkShellBinaryPath(
  packageRoot = getPackageRoot(),
  platform: NodeJS.Platform = process.platform,
  arch: string = osArch(),
  libc?: 'musl' | 'glibc',
): string {
  const platformKey = libc ? `${platform}-${arch}-${libc}` : `${platform}-${arch}`;
  return join(packageRoot, 'bin', 'native', platformKey, sparkshellBinaryName(platform));
}

export function packagedSparkShellBinaryCandidatePaths(
  packageRoot = getPackageRoot(),
  platform: NodeJS.Platform = process.platform,
  arch: string = osArch(),
  env: NodeJS.ProcessEnv = process.env,
  linuxLibcPreference?: readonly ('musl' | 'glibc')[],
): string[] {
  const candidates: string[] = [];
  if (platform === 'linux') {
    for (const libc of linuxLibcPreference ?? resolveLinuxNativeLibcPreference({ env })) {
      candidates.push(packagedSparkShellBinaryPath(packageRoot, platform, arch, libc));
    }
  }
  candidates.push(packagedSparkShellBinaryPath(packageRoot, platform, arch));
  return [...new Set(candidates)];
}

export function repoLocalSparkShellBinaryPath(
  packageRoot = getPackageRoot(),
  platform: NodeJS.Platform = process.platform,
): string {
  return join(packageRoot, 'target', 'release', sparkshellBinaryName(platform));
}

export function nestedRepoLocalSparkShellBinaryPath(
  packageRoot = getPackageRoot(),
  platform: NodeJS.Platform = process.platform,
): string {
  return join(packageRoot, 'native', 'owx-sparkshell', 'target', 'release', sparkshellBinaryName(platform));
}

export function resolveSparkShellBinaryPath(options: ResolveSparkShellBinaryPathOptions = {}): string {
  const {
    cwd = process.cwd(),
    env = process.env,
    packageRoot = getPackageRoot(),
    platform = process.platform,
    arch = osArch(),
    linuxLibcPreference,
    exists = existsSync,
  } = options;

  const override = env[OWX_SPARKSHELL_BIN_ENV]?.trim();
  if (override) {
    return isAbsolute(override) ? override : resolve(cwd, override);
  }

  for (const packaged of packagedSparkShellBinaryCandidatePaths(packageRoot, platform, arch, env, linuxLibcPreference)) {
    if (exists(packaged)) return packaged;
  }

  const repoLocal = repoLocalSparkShellBinaryPath(packageRoot, platform);
  if (exists(repoLocal)) return repoLocal;

  const nestedRepoLocal = nestedRepoLocalSparkShellBinaryPath(packageRoot, platform);
  if (exists(nestedRepoLocal)) return nestedRepoLocal;

  const packagedCandidates = packagedSparkShellBinaryCandidatePaths(packageRoot, platform, arch, env, linuxLibcPreference);
  throw new Error(
    `[sparkshell] native binary not found. Checked ${packagedCandidates.join(', ')}, ${repoLocal}, and ${nestedRepoLocal}. `
      + `Set ${OWX_SPARKSHELL_BIN_ENV} to override the path.`
  );
}

export async function resolveSparkShellBinaryPathWithHydration(
  options: ResolveSparkShellBinaryPathOptions = {},
): Promise<string> {
  const {
    cwd = process.cwd(),
    env = process.env,
    packageRoot = getPackageRoot(),
    platform = process.platform,
    arch = osArch(),
    linuxLibcPreference,
    exists = existsSync,
  } = options;

  const override = env[OWX_SPARKSHELL_BIN_ENV]?.trim();
  if (override) {
    return isAbsolute(override) ? override : resolve(cwd, override);
  }

  const version = await getPackageVersion(packageRoot);
  for (const cached of resolveCachedNativeBinaryCandidatePaths('owx-sparkshell', version, platform, arch, env, {
    linuxLibcPreference: platform === 'linux'
      ? (linuxLibcPreference ?? resolveLinuxNativeLibcPreference({ env }))
      : undefined,
  })) {
    if (exists(cached)) return cached;
  }

  for (const packaged of packagedSparkShellBinaryCandidatePaths(packageRoot, platform, arch, env, linuxLibcPreference)) {
    if (exists(packaged)) return packaged;
  }

  const repoLocal = repoLocalSparkShellBinaryPath(packageRoot, platform);
  if (exists(repoLocal)) return repoLocal;

  const nestedRepoLocal = nestedRepoLocalSparkShellBinaryPath(packageRoot, platform);
  if (exists(nestedRepoLocal)) return nestedRepoLocal;

  const hydrated = await hydrateNativeBinary('owx-sparkshell', { packageRoot, env, platform, arch });
  if (hydrated) return hydrated;

  throw new Error(
    `[sparkshell] native binary not found. Checked cached/native candidates under ${packageRoot}, ${repoLocal}, and ${nestedRepoLocal}. `
      + `Reconnect to the network so OWX can fetch the release asset, or set ${OWX_SPARKSHELL_BIN_ENV} to override the path.`
  );
}

export function runSparkShellBinary(
  binaryPath: string,
  args: readonly string[],
  options: RunSparkShellBinaryOptions = {},
): SpawnSyncReturns<string> {
  const {
    cwd = process.cwd(),
    env = process.env,
    spawnImpl = spawnSync,
  } = options;

  const configEnvOverrides = readConfiguredEnvOverrides(env.CODEX_HOME);
  const mergedEnv = {
    ...configEnvOverrides,
    ...env,
  };
  const instructionsFile = mergedEnv[OWX_SPARKSHELL_INSTRUCTIONS_FILE_ENV]?.trim()
    || join(getPackageRoot(), 'templates', 'model-instructions', 'sparkshell-lightweight-AGENTS.md');
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd,
    env: {
      ...mergedEnv,
      [OWX_SPARKSHELL_INSTRUCTIONS_FILE_ENV]: instructionsFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  };

  return spawnImpl(binaryPath, [...args], spawnOptions);
}

function writeSparkShellResultOutput(result: SpawnSyncReturns<string>): void {
  if (typeof result.stdout === 'string' && result.stdout.length > 0) process.stdout.write(result.stdout);
  if (typeof result.stderr === 'string' && result.stderr.length > 0) process.stderr.write(result.stderr);
}

const SPARKSHELL_GLIBC_INCOMPATIBLE_PATTERN = /GLIBC(?:XX)?_[0-9.]+['` ]+not found/i;

export function isSparkShellNativeCompatibilityFailure(result: SpawnSyncReturns<string>): boolean {
  if ((result.status ?? 0) === 0) return false;
  return SPARKSHELL_GLIBC_INCOMPATIBLE_PATTERN.test(result.stderr || '');
}

interface SparkShellFallbackInvocation {
  argv: string[];
  kind: 'command';
}

interface RunSparkShellFallbackOptions {
  announce?: boolean;
}

interface ParseSparkShellFallbackOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  commandExists?: (command: string) => boolean;
}

export function resolveFallbackShellArgv(
  script: string,
  options: ParseSparkShellFallbackOptions = {},
): string[] {
  const {
    platform = process.platform,
    env = process.env,
    commandExists = (command: string) => spawnSync(command, ['--version'], { encoding: 'utf-8', stdio: 'ignore' }).error === undefined,
  } = options;

  if (platform !== 'win32') return ['sh', '-lc', script];
  if (commandExists('pwsh')) return ['pwsh', '-NoLogo', '-NoProfile', '-Command', script];
  if (commandExists('powershell.exe')) return ['powershell.exe', '-NoLogo', '-NoProfile', '-Command', script];
  return [env.ComSpec?.trim() || 'cmd.exe', '/d', '/s', '/c', script];
}

export function parseSparkShellFallbackInvocation(
  args: readonly string[],
  options: ParseSparkShellFallbackOptions = {},
): SparkShellFallbackInvocation {
  if (args.length === 0) {
    throw new Error(`Missing command to run.\n${SPARKSHELL_USAGE}`);
  }

  if (args[0] === '--shell') {
    const script = args[1];
    if (!script) throw new Error(`--shell requires a command string.\n${SPARKSHELL_USAGE}`);
    return { kind: 'command', argv: resolveFallbackShellArgv(script, options) };
  }
  if (args[0]?.startsWith('--shell=')) {
    const script = args[0].slice('--shell='.length);
    if (!script.trim()) throw new Error(`--shell requires a command string.\n${SPARKSHELL_USAGE}`);
    return { kind: 'command', argv: resolveFallbackShellArgv(script, options) };
  }

  return { kind: 'command', argv: [...args] };
}

function runSparkShellFallback(args: readonly string[], options: RunSparkShellFallbackOptions = {}): void {
  const { announce = true } = options;
  const invocation = parseSparkShellFallbackInvocation(args);
  if (announce) {
    process.stderr.write('[sparkshell] native helper unavailable; falling back to raw command execution without summary support.\n');
  }
  const result = spawnSync(invocation.argv[0], invocation.argv.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    encoding: 'utf-8',
  });
  if (result.error) {
    const errno = result.error as NodeJS.ErrnoException;
    const kind = classifySpawnError(errno);
    if (kind === 'missing') {
      throw new Error(`[sparkshell] raw fallback failed: executable not found (${invocation.argv[0]})`);
    }
    if (kind === 'blocked') {
      throw new Error(`[sparkshell] raw fallback failed: executable is blocked (${errno.code || 'blocked'})`);
    }
    throw new Error(`[sparkshell] raw fallback failed: ${errno.message}`);
  }
  if (result.status !== 0) {
    process.exitCode = typeof result.status === 'number'
      ? result.status
      : resolveSignalExitCode(result.signal);
  }
}

export async function sparkshellCommand(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(SPARKSHELL_USAGE);
    return;
  }

  if (args.length === 0) {
    throw new Error(`Missing command to run.\n${SPARKSHELL_USAGE}`);
  }

  const hasExplicitOverride = typeof process.env[OWX_SPARKSHELL_BIN_ENV] === 'string'
    && process.env[OWX_SPARKSHELL_BIN_ENV]!.trim().length > 0;
  let binaryPath: string;
  try {
    binaryPath = await resolveSparkShellBinaryPathWithHydration();
  } catch (error) {
    if (!hasExplicitOverride) {
      runSparkShellFallback(args);
      return;
    }
    throw error;
  }
  const result = runSparkShellBinary(binaryPath, args);

  if (result.error) {
    const errno = result.error as NodeJS.ErrnoException;
    const kind = classifySpawnError(errno);
    if (!hasExplicitOverride && (kind === 'missing' || kind === 'blocked')) {
      runSparkShellFallback(args);
      return;
    }
    if (kind === 'missing') {
      throw new Error(`[sparkshell] failed to launch native binary: executable not found (${binaryPath})`);
    }
    if (kind === 'blocked') {
      throw new Error(`[sparkshell] failed to launch native binary: executable is blocked (${errno.code || 'blocked'})`);
    }
    throw new Error(`[sparkshell] failed to launch native binary: ${errno.message}`);
  }

  if (!hasExplicitOverride && isSparkShellNativeCompatibilityFailure(result)) {
    process.stderr.write('[sparkshell] GLIBC-incompatible native helper detected; falling back to raw command execution without summary support.\n');
    runSparkShellFallback(args, { announce: false });
    return;
  }

  writeSparkShellResultOutput(result);

  if (result.status !== 0) {
    process.exitCode = typeof result.status === 'number'
      ? result.status
      : resolveSignalExitCode(result.signal);
  }
}
