import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPackageRoot } from '../utils/package.js';

export type SurfaceCommandTier = 'core' | 'advanced' | 'internal';
export type SurfaceCommandStatus = 'stable' | 'beta' | 'legacy' | 'deprecated' | 'internal';
export type SurfaceCommandVisibility = 'default' | 'advanced' | 'internal' | 'legacy' | 'deprecated';
export type SurfaceConceptStatus = 'stable' | 'beta' | 'planned' | 'legacy' | 'deprecated' | 'internal';

export interface SurfaceCommandDocs {
  canonical?: string;
  troubleshooting?: string;
}

export interface SurfaceCommandNestedHelp {
  required: boolean;
  expected_heading?: string;
}

export interface SurfaceCommandEntry {
  name: string;
  tier: SurfaceCommandTier;
  status: SurfaceCommandStatus;
  hidden: boolean;
  visibility: SurfaceCommandVisibility;
  owner: string;
  purpose: string;
  docs: SurfaceCommandDocs;
  nested_help: SurfaceCommandNestedHelp;
  output_contract?: string;
}

export interface SurfaceConceptEntry {
  term: string;
  public: boolean;
  status: SurfaceConceptStatus;
  definition: string;
  aliases: string[];
  allowed_in: string[];
  forbidden_in: string[];
  replaced_by?: string;
}

export interface SurfaceRegistry {
  schemaVersion: number;
  commandsPath: string;
  conceptsPath: string;
  commands: SurfaceCommandEntry[];
  concepts: SurfaceConceptEntry[];
}

export const SURFACE_SCHEMA_VERSION = 1;

const COMMAND_TIERS = new Set<SurfaceCommandTier>(['core', 'advanced', 'internal']);
const COMMAND_STATUSES = new Set<SurfaceCommandStatus>(['stable', 'beta', 'legacy', 'deprecated', 'internal']);
const COMMAND_VISIBILITIES = new Set<SurfaceCommandVisibility>(['default', 'advanced', 'internal', 'legacy', 'deprecated']);
const CONCEPT_STATUSES = new Set<SurfaceConceptStatus>(['stable', 'beta', 'planned', 'legacy', 'deprecated', 'internal']);

type RegistryScalar = string | boolean;
type RegistryObject = Record<string, RegistryScalar>;
type RegistryYamlValue = RegistryScalar | RegistryObject | string[];
type RegistryYamlRecord = Record<string, RegistryYamlValue>;
interface RegistryYamlDocument {
  schemaVersion: number;
  records: RegistryYamlRecord[];
}

function parseScalar(raw: string, field: string): RegistryScalar {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length === 0) {
    throw new Error(`surface_registry_invalid:${field}`);
  }
  return value;
}

function parseKeyValue(raw: string, path: string, lineNumber: number): { key: string; value?: RegistryScalar } {
  const match = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
  if (!match) {
    throw new Error(`surface_registry_invalid:${path}:${lineNumber}`);
  }
  const [, key, value] = match;
  if (!key) {
    throw new Error(`surface_registry_invalid:${path}:${lineNumber}:${key ?? 'key'}`);
  }
  return {
    key,
    ...(value === undefined ? {} : { value: parseScalar(value, `${path}:${lineNumber}:${key}`) }),
  };
}

function assignKeyValue(target: RegistryYamlRecord | RegistryObject, raw: string, path: string, lineNumber: number): string | null {
  const { key, value } = parseKeyValue(raw, path, lineNumber);
  if (value === undefined) {
    target[key] = {};
    return key;
  }
  target[key] = value;
  return null;
}

function indentation(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function assignNestedValue(
  target: RegistryYamlRecord,
  key: string,
  raw: string,
  path: string,
  lineNumber: number,
): void {
  const value = target[key];
  if (raw.startsWith('- ')) {
    if (Array.isArray(value)) {
      const item = parseScalar(raw.slice(2), `${path}:${lineNumber}:${key}`);
      if (typeof item !== 'string') throw new Error(`surface_registry_invalid:${path}:${lineNumber}:${key}`);
      value.push(item);
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      const item = parseScalar(raw.slice(2), `${path}:${lineNumber}:${key}`);
      if (typeof item !== 'string') throw new Error(`surface_registry_invalid:${path}:${lineNumber}:${key}`);
      target[key] = [item];
      return;
    }
    throw new Error(`surface_registry_invalid:${path}:${lineNumber}:${key}`);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`surface_registry_invalid:${path}:${lineNumber}:${key}`);
  }
  assignKeyValue(value, raw, path, lineNumber);
}

function parseSchemaVersion(raw: string, path: string, lineNumber: number): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`surface_registry_invalid:${path}:${lineNumber}:schema_version`);
  }
  const schemaVersion = Number(raw.trim());
  if (schemaVersion !== SURFACE_SCHEMA_VERSION) {
    throw new Error(`surface_registry_unsupported_schema:${path}:${schemaVersion}`);
  }
  return schemaVersion;
}

function parseFlatListDocument(raw: string, rootKey: string, path: string): RegistryYamlDocument {
  const items: RegistryYamlRecord[] = [];
  let schemaVersion: number | null = null;
  let sawRoot = false;
  let current: RegistryYamlRecord | null = null;
  let activeNestedKey: string | null = null;

  const pushCurrent = (): void => {
    if (current) items.push(current);
    current = null;
  };

  raw.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (!sawRoot) {
      const schemaMatch = trimmed.match(/^schema_version:(?:\s+(.*))?$/);
      if (schemaMatch) {
        if (schemaVersion !== null) {
          throw new Error(`surface_registry_invalid:${path}:${lineNumber}:duplicate_schema_version`);
        }
        if (schemaMatch[1] === undefined) {
          throw new Error(`surface_registry_invalid:${path}:${lineNumber}:schema_version`);
        }
        schemaVersion = parseSchemaVersion(schemaMatch[1], path, lineNumber);
        return;
      }
      if (trimmed !== `${rootKey}:`) {
        throw new Error(`surface_registry_invalid:${path}:${lineNumber}:root`);
      }
      if (schemaVersion === null) {
        throw new Error(`surface_registry_invalid:${path}:${lineNumber}:missing_schema_version`);
      }
      sawRoot = true;
      return;
    }
    const indent = indentation(line);
    if (indent === 2 && trimmed.startsWith('- ')) {
      pushCurrent();
      current = {};
      activeNestedKey = assignKeyValue(current, trimmed.slice(2), path, lineNumber);
      return;
    }
    if (!current) {
      throw new Error(`surface_registry_invalid:${path}:${lineNumber}:indentation`);
    }
    if (indent === 4) {
      activeNestedKey = assignKeyValue(current, trimmed, path, lineNumber);
      return;
    }
    if (indent === 6 && activeNestedKey) {
      assignNestedValue(current, activeNestedKey, trimmed, path, lineNumber);
      return;
    }
    throw new Error(`surface_registry_invalid:${path}:${lineNumber}:indentation`);
  });

  pushCurrent();
  if (!sawRoot || items.length === 0) {
    throw new Error(`surface_registry_invalid:${path}:empty`);
  }
  if (schemaVersion === null) {
    throw new Error(`surface_registry_invalid:${path}:missing_schema_version`);
  }
  return { schemaVersion, records: items };
}

function requiredString(record: RegistryYamlRecord | RegistryObject, key: string, path: string, index: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`surface_registry_invalid:${path}:${index}.${key}`);
  }
  return value.trim();
}

function optionalString(record: RegistryYamlRecord | RegistryObject, key: string, path: string, index: number): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`surface_registry_invalid:${path}:${index}.${key}`);
  }
  return value.trim();
}

function requiredBoolean(record: RegistryYamlRecord | RegistryObject, key: string, path: string, index: number): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`surface_registry_invalid:${path}:${index}.${key}`);
  }
  return value;
}

function optionalObject(record: RegistryYamlRecord, key: string, path: string, index: number): RegistryObject | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`surface_registry_invalid:${path}:${index}.${key}`);
  }
  return value;
}

function optionalStringList(record: RegistryYamlRecord, key: string, path: string, index: number): string[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`surface_registry_invalid:${path}:${index}.${key}`);
  }
  return value.map((item) => item.trim());
}

function validateUnique(names: string[], label: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`surface_registry_invalid:duplicate_${label}:${name}`);
    seen.add(name);
  }
}

function validateKnownKeys(
  record: RegistryYamlRecord | RegistryObject,
  allowedKeys: readonly string[],
  path: string,
  index: number,
  label = '',
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`surface_registry_invalid:${path}:${index}.${label}${key}`);
    }
  }
}

function readRequiredFile(path: string): string {
  if (!existsSync(path)) throw new Error(`surface_registry_missing:${path}`);
  return readFileSync(path, 'utf-8');
}

function defaultVisibility(tier: SurfaceCommandTier, status: SurfaceCommandStatus): SurfaceCommandVisibility {
  if (status === 'deprecated') return 'deprecated';
  if (status === 'legacy') return 'legacy';
  if (status === 'internal' || tier === 'internal') return 'internal';
  if (tier === 'advanced') return 'advanced';
  return 'default';
}

function readCommandDocs(record: RegistryYamlRecord, path: string, index: number): SurfaceCommandDocs {
  const docs = optionalObject(record, 'docs', path, index);
  if (!docs) return {};
  validateKnownKeys(docs, ['canonical', 'troubleshooting'], path, index, 'docs.');
  const canonical = optionalString(docs, 'canonical', path, index);
  const troubleshooting = optionalString(docs, 'troubleshooting', path, index);
  return {
    ...(canonical ? { canonical } : {}),
    ...(troubleshooting ? { troubleshooting } : {}),
  };
}

function readNestedHelp(record: RegistryYamlRecord, hidden: boolean, path: string, index: number): SurfaceCommandNestedHelp {
  const nestedHelp = optionalObject(record, 'nested_help', path, index);
  if (!nestedHelp) return { required: !hidden };
  validateKnownKeys(nestedHelp, ['required', 'expected_heading'], path, index, 'nested_help.');
  const expectedHeading = optionalString(nestedHelp, 'expected_heading', path, index);
  return {
    required: requiredBoolean(nestedHelp, 'required', path, index),
    ...(expectedHeading ? { expected_heading: expectedHeading } : {}),
  };
}

export function readSurfaceCommandDocument(path: string): { schemaVersion: number; commands: SurfaceCommandEntry[] } {
  const document = parseFlatListDocument(readRequiredFile(path), 'commands', path);
  const commands = document.records.map((record, index): SurfaceCommandEntry => {
    validateKnownKeys(record, [
      'name',
      'tier',
      'status',
      'hidden',
      'visibility',
      'owner',
      'purpose',
      'docs',
      'nested_help',
      'output_contract',
    ], path, index);
    const name = requiredString(record, 'name', path, index);
    if (!/^owx(?:\s+[a-z][a-z0-9-]*)?$/.test(name)) {
      throw new Error(`surface_registry_invalid:${path}:${index}.name`);
    }
    const tier = requiredString(record, 'tier', path, index) as SurfaceCommandTier;
    const status = requiredString(record, 'status', path, index) as SurfaceCommandStatus;
    if (!COMMAND_TIERS.has(tier)) throw new Error(`surface_registry_invalid:${path}:${index}.tier`);
    if (!COMMAND_STATUSES.has(status)) throw new Error(`surface_registry_invalid:${path}:${index}.status`);
    const visibility = (optionalString(record, 'visibility', path, index) ?? defaultVisibility(tier, status)) as SurfaceCommandVisibility;
    if (!COMMAND_VISIBILITIES.has(visibility)) throw new Error(`surface_registry_invalid:${path}:${index}.visibility`);
    const hidden = requiredBoolean(record, 'hidden', path, index);
    const outputContract = optionalString(record, 'output_contract', path, index);
    return {
      name,
      tier,
      status,
      hidden,
      visibility,
      owner: optionalString(record, 'owner', path, index) ?? 'surface-owner',
      purpose: requiredString(record, 'purpose', path, index),
      docs: readCommandDocs(record, path, index),
      nested_help: readNestedHelp(record, hidden, path, index),
      ...(outputContract ? { output_contract: outputContract } : {}),
    };
  });
  validateUnique(commands.map((entry) => entry.name), 'command');
  return { schemaVersion: document.schemaVersion, commands };
}

export function readSurfaceCommands(path: string): SurfaceCommandEntry[] {
  return readSurfaceCommandDocument(path).commands;
}

export function readSurfaceConceptDocument(path: string): { schemaVersion: number; concepts: SurfaceConceptEntry[] } {
  const document = parseFlatListDocument(readRequiredFile(path), 'concepts', path);
  const concepts = document.records.map((record, index): SurfaceConceptEntry => {
    validateKnownKeys(record, [
      'term',
      'public',
      'status',
      'definition',
      'aliases',
      'allowed_in',
      'forbidden_in',
      'replaced_by',
    ], path, index);
    const status = requiredString(record, 'status', path, index) as SurfaceConceptStatus;
    if (!CONCEPT_STATUSES.has(status)) throw new Error(`surface_registry_invalid:${path}:${index}.status`);
    const replacedBy = record.replaced_by;
    if (replacedBy !== undefined && typeof replacedBy !== 'string') {
      throw new Error(`surface_registry_invalid:${path}:${index}.replaced_by`);
    }
    return {
      term: requiredString(record, 'term', path, index),
      public: requiredBoolean(record, 'public', path, index),
      status,
      definition: requiredString(record, 'definition', path, index),
      aliases: optionalStringList(record, 'aliases', path, index),
      allowed_in: optionalStringList(record, 'allowed_in', path, index),
      forbidden_in: optionalStringList(record, 'forbidden_in', path, index),
      ...(replacedBy ? { replaced_by: replacedBy } : {}),
    };
  });
  validateUnique(concepts.map((entry) => entry.term.toLowerCase()), 'concept');
  return { schemaVersion: document.schemaVersion, concepts };
}

export function readSurfaceConcepts(path: string): SurfaceConceptEntry[] {
  return readSurfaceConceptDocument(path).concepts;
}

export function surfaceRegistryPaths(packageRoot = getPackageRoot()): { commandsPath: string; conceptsPath: string } {
  return {
    commandsPath: join(packageRoot, 'surface', 'commands.yml'),
    conceptsPath: join(packageRoot, 'surface', 'concepts.yml'),
  };
}

export function readSurfaceRegistry(packageRoot = getPackageRoot()): SurfaceRegistry {
  const paths = surfaceRegistryPaths(packageRoot);
  const commands = readSurfaceCommandDocument(paths.commandsPath);
  const concepts = readSurfaceConceptDocument(paths.conceptsPath);
  if (commands.schemaVersion !== concepts.schemaVersion) {
    throw new Error(`surface_registry_invalid:schema_version_mismatch:${commands.schemaVersion}:${concepts.schemaVersion}`);
  }
  return {
    schemaVersion: commands.schemaVersion,
    ...paths,
    commands: commands.commands,
    concepts: concepts.concepts,
  };
}
