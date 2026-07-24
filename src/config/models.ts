/**
 * Model Configuration
 *
 * Reads per-mode model overrides and default-env overrides from .owx-config.json.
 *
 * Config format:
 * {
 *   "env": {
 *     "OWX_DEFAULT_FRONTIER_MODEL": "your-frontier-model",
 *     "OWX_DEFAULT_STANDARD_MODEL": "your-standard-model",
 *     "OWX_DEFAULT_SPARK_MODEL": "your-spark-model"
 *   },
 *   "models": {
 *     "default": "o4-mini"
 *   },
 *   "agentReasoning": {
 *     "architect": "xhigh"
 *   }
 * }
 *
 * Resolution: mode-specific > "default" key > OWX_DEFAULT_FRONTIER_MODEL > DEFAULT_FRONTIER_MODEL
 */

import { parse as parseToml } from '@iarna/toml';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { codexConfigPath, codexHome } from '../utils/paths.js';

export interface ModelsConfig {
  [mode: string]: string | undefined;
}

export interface OmxConfigEnv {
  [key: string]: string | undefined;
}

export type ConfiguredAgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

interface OmxConfigFile {
  agentReasoning?: Record<string, unknown>;
  env?: OmxConfigEnv;
  models?: ModelsConfig;
}

interface CodexConfigFile {
  model?: unknown;
  model_provider?: unknown;
  model_providers?: Record<string, unknown>;
}

export const OWX_DEFAULT_FRONTIER_MODEL_ENV = 'OWX_DEFAULT_FRONTIER_MODEL';
export const OWX_DEFAULT_STANDARD_MODEL_ENV = 'OWX_DEFAULT_STANDARD_MODEL';
export const OWX_DEFAULT_SPARK_MODEL_ENV = 'OWX_DEFAULT_SPARK_MODEL';
export const OWX_SPARK_MODEL_ENV = 'OWX_SPARK_MODEL';

function readOmxConfigFile(codexHomeOverride?: string): OmxConfigFile | null {
  const configPath = join(codexHomeOverride || codexHome(), '.owx-config.json');
  if (!existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as OmxConfigFile;
  } catch {
    return null;
  }
}

function readCodexConfigFile(codexHomeOverride?: string): CodexConfigFile | null {
  const configPath = codexHomeOverride
    ? join(codexHomeOverride, 'config.toml')
    : codexConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const raw = parseToml(readFileSync(configPath, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as CodexConfigFile;
  } catch {
    return null;
  }
}

function readModelsBlock(codexHomeOverride?: string): ModelsConfig | null {
  const config = readOmxConfigFile(codexHomeOverride);
  if (!config) return null;
  if (config.models && typeof config.models === 'object' && !Array.isArray(config.models)) {
    return config.models;
  }
  return null;
}

export const DEFAULT_FRONTIER_MODEL = 'gpt-5.5';
export const DEFAULT_STANDARD_MODEL = 'gpt-5.4-mini';
export const DEFAULT_SPARK_MODEL = 'gpt-5.3-codex-spark';

function normalizeConfiguredValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeAgentReasoningEffort(value: unknown): ConfiguredAgentReasoningEffort | undefined {
  const normalized = normalizeConfiguredValue(value)?.toLowerCase();
  if (
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high' ||
    normalized === 'xhigh'
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeAgentName(value: unknown): string | undefined {
  const normalized = normalizeConfiguredValue(value)?.toLowerCase();
  return normalized && /^[a-z0-9][a-z0-9_-]*$/.test(normalized) ? normalized : undefined;
}

function readConfigEnvValue(key: string, codexHomeOverride?: string): string | undefined {
  const config = readOmxConfigFile(codexHomeOverride);
  if (!config || !config.env || typeof config.env !== 'object' || Array.isArray(config.env)) {
    return undefined;
  }
  return normalizeConfiguredValue(config.env[key]);
}

export function readConfiguredEnvOverrides(codexHomeOverride?: string): NodeJS.ProcessEnv {
  const config = readOmxConfigFile(codexHomeOverride);
  if (!config || !config.env || typeof config.env !== 'object' || Array.isArray(config.env)) {
    return {};
  }

  const resolved: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(config.env)) {
    const normalized = normalizeConfiguredValue(value);
    if (normalized) resolved[key] = normalized;
  }
  return resolved;
}

export function readAgentReasoningOverrides(
  codexHomeOverride?: string,
): Record<string, ConfiguredAgentReasoningEffort> {
  const config = readOmxConfigFile(codexHomeOverride);
  const raw = config?.agentReasoning;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const resolved: Record<string, ConfiguredAgentReasoningEffort> = {};
  for (const [key, value] of Object.entries(raw)) {
    const role = normalizeAgentName(key);
    const effort = normalizeAgentReasoningEffort(value);
    if (role && effort) resolved[role] = effort;
  }
  return resolved;
}

export function getAgentReasoningOverride(
  agentName: string | undefined,
  codexHomeOverride?: string,
): ConfiguredAgentReasoningEffort | undefined {
  const normalized = normalizeAgentName(agentName);
  if (!normalized) return undefined;
  return readAgentReasoningOverrides(codexHomeOverride)[normalized];
}

export function readActiveProviderEnvOverrides(
  env: NodeJS.ProcessEnv = process.env,
  codexHomeOverride?: string,
  activeProviderOverride?: string,
): NodeJS.ProcessEnv {
  const config = readCodexConfigFile(codexHomeOverride);
  if (!config) return {};

  const activeProvider = normalizeConfiguredValue(activeProviderOverride) ?? normalizeConfiguredValue(config.model_provider);
  if (!activeProvider) return {};

  const providers = config.model_providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    return {};
  }

  const providerConfig = providers[activeProvider];
  if (!providerConfig || typeof providerConfig !== 'object' || Array.isArray(providerConfig)) {
    return {};
  }

  const envKey = normalizeConfiguredValue((providerConfig as Record<string, unknown>).env_key);
  if (!envKey) return {};

  const envValue = normalizeConfiguredValue(env[envKey]);
  return envValue ? { [envKey]: envValue } : {};
}

export function getEnvConfiguredMainDefaultModel(
  env: NodeJS.ProcessEnv = process.env,
  codexHomeOverride?: string,
): string | undefined {
  return normalizeConfiguredValue(env[OWX_DEFAULT_FRONTIER_MODEL_ENV])
    ?? readConfigEnvValue(OWX_DEFAULT_FRONTIER_MODEL_ENV, codexHomeOverride);
}

function getCodexConfigRootModel(codexHomeOverride?: string): string | undefined {
  return normalizeConfiguredValue(readCodexConfigFile(codexHomeOverride)?.model);
}

export function getCodexConfigRootModelProvider(codexHomeOverride?: string): string | undefined {
  return normalizeConfiguredValue(readCodexConfigFile(codexHomeOverride)?.model_provider);
}

export function getEnvConfiguredStandardDefaultModel(
  env: NodeJS.ProcessEnv = process.env,
  codexHomeOverride?: string,
): string | undefined {
  return normalizeConfiguredValue(env[OWX_DEFAULT_STANDARD_MODEL_ENV])
    ?? readConfigEnvValue(OWX_DEFAULT_STANDARD_MODEL_ENV, codexHomeOverride);
}

export function getEnvConfiguredSparkDefaultModel(
  env: NodeJS.ProcessEnv = process.env,
  codexHomeOverride?: string,
): string | undefined {
  return normalizeConfiguredValue(env[OWX_DEFAULT_SPARK_MODEL_ENV])
    ?? normalizeConfiguredValue(env[OWX_SPARK_MODEL_ENV])
    ?? readConfigEnvValue(OWX_DEFAULT_SPARK_MODEL_ENV, codexHomeOverride)
    ?? readConfigEnvValue(OWX_SPARK_MODEL_ENV, codexHomeOverride);
}


/**
 * Get the envvar-backed main/default model.
 * Resolution: OWX_DEFAULT_FRONTIER_MODEL > config.toml model > DEFAULT_FRONTIER_MODEL
 */
export function getMainDefaultModel(codexHomeOverride?: string): string {
  return getEnvConfiguredMainDefaultModel(process.env, codexHomeOverride)
    ?? getCodexConfigRootModel(codexHomeOverride)
    ?? DEFAULT_FRONTIER_MODEL;
}

/**
 * Get the envvar-backed standard/default subagent model.
 *
 * Standard-role subagents inherit the configured main/default model unless an
 * explicit standard-lane override is configured. This keeps spawned agents in
 * sync with the leader model while preserving OWX_DEFAULT_STANDARD_MODEL as the
 * opt-in escape hatch for cheaper/specialized standard workers.
 *
 * Resolution: OWX_DEFAULT_STANDARD_MODEL > OWX_DEFAULT_FRONTIER_MODEL > config.toml model > DEFAULT_FRONTIER_MODEL
 */
export function getStandardDefaultModel(codexHomeOverride?: string): string {
  return getEnvConfiguredStandardDefaultModel(process.env, codexHomeOverride)
    ?? getMainDefaultModel(codexHomeOverride);
}

/**
 * Get the configured model for a specific mode.
 * Resolution: mode-specific override > "default" key > OWX_DEFAULT_FRONTIER_MODEL > DEFAULT_FRONTIER_MODEL
 */
export function getModelForMode(mode: string, codexHomeOverride?: string): string {
  const models = readModelsBlock(codexHomeOverride);
  const modeValue = normalizeConfiguredValue(models?.[mode]);
  if (modeValue) return modeValue;

  const defaultValue = normalizeConfiguredValue(models?.default);
  if (defaultValue) return defaultValue;

  return getMainDefaultModel(codexHomeOverride);
}

/**
 * Get the envvar-backed spark/low-complexity default model.
 * Resolution: OWX_DEFAULT_SPARK_MODEL > OWX_SPARK_MODEL > DEFAULT_SPARK_MODEL
 */
export function getSparkDefaultModel(codexHomeOverride?: string): string {
  return getEnvConfiguredSparkDefaultModel(process.env, codexHomeOverride)
    ?? DEFAULT_SPARK_MODEL;
}
