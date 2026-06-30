import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPackageRoot } from '../utils/package.js';

export type SurfaceCommandTier = 'core' | 'advanced' | 'internal';
export type SurfaceCommandStatus = 'stable' | 'beta' | 'legacy' | 'deprecated' | 'internal';
export type SurfaceConceptStatus = 'stable' | 'beta' | 'planned' | 'legacy' | 'deprecated' | 'internal';

export interface SurfaceCommandEntry {
  name: string;
  tier: SurfaceCommandTier;
  status: SurfaceCommandStatus;
  hidden: boolean;
  purpose: string;
}

export interface SurfaceConceptEntry {
  term: string;
  public: boolean;
  status: SurfaceConceptStatus;
  definition: string;
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
const CONCEPT_STATUSES = new Set<SurfaceConceptStatus>(['stable', 'beta', 'planned', 'legacy', 'deprecated', 'internal']);

type FlatYamlValue = string | boolean;
type FlatYamlRecord = Record<string, FlatYamlValue>;
interface FlatYamlDocument {
  schemaVersion: number;
  records: FlatYamlRecord[];
}

function parseScalar(raw: string, field: string): FlatYamlValue {
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

function assignKeyValue(target: FlatYamlRecord, raw: string, path: string, lineNumber: number): void {
  const match = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
  if (!match) {
    throw new Error(`surface_registry_invalid:${path}:${lineNumber}`);
  }
  const [, key, value] = match;
  if (!key || value === undefined) {
    throw new Error(`surface_registry_invalid:${path}:${lineNumber}:${key ?? 'key'}`);
  }
  target[key] = parseScalar(value, `${path}:${lineNumber}:${key}`);
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

function parseFlatListDocument(raw: string, rootKey: string, path: string): FlatYamlDocument {
  const items: FlatYamlRecord[] = [];
  let schemaVersion: number | null = null;
  let sawRoot = false;
  let current: FlatYamlRecord | null = null;

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
    if (trimmed.startsWith('- ')) {
      pushCurrent();
      current = {};
      assignKeyValue(current, trimmed.slice(2), path, lineNumber);
      return;
    }
    if (!current || !line.startsWith('    ')) {
      throw new Error(`surface_registry_invalid:${path}:${lineNumber}:indentation`);
    }
    assignKeyValue(current, trimmed, path, lineNumber);
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

function requiredString(record: FlatYamlRecord, key: string, path: string, index: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`surface_registry_invalid:${path}:${index}.${key}`);
  }
  return value.trim();
}

function requiredBoolean(record: FlatYamlRecord, key: string, path: string, index: number): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`surface_registry_invalid:${path}:${index}.${key}`);
  }
  return value;
}

function validateUnique(names: string[], label: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`surface_registry_invalid:duplicate_${label}:${name}`);
    seen.add(name);
  }
}

function readRequiredFile(path: string): string {
  if (!existsSync(path)) throw new Error(`surface_registry_missing:${path}`);
  return readFileSync(path, 'utf-8');
}

export function readSurfaceCommandDocument(path: string): { schemaVersion: number; commands: SurfaceCommandEntry[] } {
  const document = parseFlatListDocument(readRequiredFile(path), 'commands', path);
  const commands = document.records.map((record, index): SurfaceCommandEntry => {
    const name = requiredString(record, 'name', path, index);
    if (!/^owx(?:\s+[a-z][a-z0-9-]*)?$/.test(name)) {
      throw new Error(`surface_registry_invalid:${path}:${index}.name`);
    }
    const tier = requiredString(record, 'tier', path, index) as SurfaceCommandTier;
    const status = requiredString(record, 'status', path, index) as SurfaceCommandStatus;
    if (!COMMAND_TIERS.has(tier)) throw new Error(`surface_registry_invalid:${path}:${index}.tier`);
    if (!COMMAND_STATUSES.has(status)) throw new Error(`surface_registry_invalid:${path}:${index}.status`);
    return {
      name,
      tier,
      status,
      hidden: requiredBoolean(record, 'hidden', path, index),
      purpose: requiredString(record, 'purpose', path, index),
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
