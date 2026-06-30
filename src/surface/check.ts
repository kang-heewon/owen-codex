import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readSurfaceRegistry, surfaceRegistryPaths, type SurfaceRegistry } from './registry.js';

export type SurfaceCheckStatus = 'passed' | 'failed';
export type SurfaceIssueSeverity = 'error' | 'warning';

export interface SurfaceCheckIssue {
  code: string;
  severity: SurfaceIssueSeverity;
  message: string;
  command?: string;
  document?: string;
  term?: string;
}

export interface SurfaceCheckSummary {
  name: string;
  status: SurfaceCheckStatus;
  detail: string;
}

export interface SurfaceCheckResult {
  status: SurfaceCheckStatus;
  checks: SurfaceCheckSummary[];
  issues: SurfaceCheckIssue[];
  helpCommands: string[];
  registeredCommands: string[];
  conceptDocuments: string[];
  registeredConcepts: string[];
  registry: {
    schemaVersion: number | null;
    commandsPath: string;
    conceptsPath: string;
  };
}

export interface SurfaceTextDocument {
  path: string;
  text: string;
}

export interface RunSurfaceCheckOptions {
  packageRoot?: string;
  helpText: string;
  registry?: SurfaceRegistry;
  publicDocuments?: SurfaceTextDocument[];
}

const PUBLIC_DOC_FILES = [
  'README.md',
  'GETTING_STARTED.md',
  'CONCEPTS.md',
  'COMMANDS.md',
  'TROUBLESHOOTING.md',
  'SAFETY.md',
];
const PUBLIC_DOC_DIRS = ['docs'];

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function extractHelpCommands(helpText: string): string[] {
  const commands = new Set<string>();
  for (const line of helpText.split(/\r?\n/)) {
    const match = line.match(/^  owx(?:\s+([a-z][a-z0-9-]*))?(?:\s|$)/);
    if (!match) continue;
    commands.add(`owx${match[1] ? ` ${match[1]}` : ''}`);
  }
  return [...commands].sort((a, b) => a.localeCompare(b));
}

function readMarkdownDocuments(root: string, relativeDir: string): SurfaceTextDocument[] {
  const absoluteDir = join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  const documents: SurfaceTextDocument[] = [];
  const entries = readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relativePath = join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      documents.push(...readMarkdownDocuments(root, relativePath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    documents.push({
      path: relativePath,
      text: readFileSync(join(root, relativePath), 'utf-8'),
    });
  }
  return documents;
}

export function readPublicSurfaceDocuments(packageRoot: string): SurfaceTextDocument[] {
  const rootFiles = PUBLIC_DOC_FILES
    .map((path): SurfaceTextDocument | null => {
      const absolutePath = join(packageRoot, path);
      if (!existsSync(absolutePath)) return null;
      return { path, text: readFileSync(absolutePath, 'utf-8') };
    })
    .filter((document): document is SurfaceTextDocument => document !== null);
  return [
    ...rootFiles,
    ...PUBLIC_DOC_DIRS.flatMap((path) => readMarkdownDocuments(packageRoot, path)),
  ].sort((a, b) => a.path.localeCompare(b.path));
}

function isVisibleRegisteredCommand(entry: SurfaceRegistry['commands'][number]): boolean {
  return !entry.hidden;
}

function isPublicConcept(entry: SurfaceRegistry['concepts'][number]): boolean {
  return entry.public && !['deprecated', 'internal', 'legacy'].includes(entry.status);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(text: string, term: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(term)}(?=$|[^A-Za-z0-9])`).test(text);
}

function extractConceptDeclarations(text: string): string[] {
  const terms = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:[-*]\s*)?(?:public\s+)?concept:\s+(.+)$/i);
    if (!match) continue;
    const term = match[1]
      ?.trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\s+(?:[-:;].*)$/, '');
    if (term) terms.add(term);
  }
  return [...terms].sort((a, b) => a.localeCompare(b));
}

function checkConceptDocuments(registry: SurfaceRegistry, documents: SurfaceTextDocument[]): SurfaceCheckIssue[] {
  const issues: SurfaceCheckIssue[] = [];
  const conceptsByTerm = new Map(registry.concepts.map((entry) => [entry.term.toLowerCase(), entry]));
  const nonPublicConcepts = registry.concepts.filter((entry) => !isPublicConcept(entry));
  const seen = new Set<string>();

  const pushIssue = (issue: SurfaceCheckIssue): void => {
    const key = `${issue.code}:${issue.document ?? ''}:${issue.term ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const document of documents) {
    for (const term of extractConceptDeclarations(document.text)) {
      const concept = conceptsByTerm.get(term.toLowerCase());
      if (!concept) {
        pushIssue({
          code: 'unregistered_public_concept',
          severity: 'error',
          document: document.path,
          term,
          message: `${document.path} declares public concept "${term}" but it is missing from surface/concepts.yml`,
        });
        continue;
      }
      if (!isPublicConcept(concept)) {
        pushIssue({
          code: 'non_public_concept_declared',
          severity: 'error',
          document: document.path,
          term: concept.term,
          message: `${document.path} declares "${concept.term}" as public text, but surface/concepts.yml marks it ${concept.status}${concept.replaced_by ? ` replaced by ${concept.replaced_by}` : ''}`,
        });
      }
    }

    for (const concept of nonPublicConcepts) {
      if (!containsTerm(document.text, concept.term)) continue;
      pushIssue({
        code: 'non_public_concept_in_public_docs',
        severity: 'error',
        document: document.path,
        term: concept.term,
        message: `${document.path} uses non-public concept "${concept.term}" marked ${concept.status}${concept.replaced_by ? `; use ${concept.replaced_by}` : ''}`,
      });
    }
  }

  return issues;
}

export function runSurfaceCheck(options: RunSurfaceCheckOptions): SurfaceCheckResult {
  const helpCommands = extractHelpCommands(options.helpText);
  let registry: SurfaceRegistry;
  try {
    registry = options.registry ?? readSurfaceRegistry(options.packageRoot);
  } catch (error) {
    const paths = surfaceRegistryPaths(options.packageRoot);
    return {
      status: 'failed',
      checks: [
        {
          name: 'surface-registry-load',
          status: 'failed',
          detail: formatError(error),
        },
      ],
      issues: [
        {
          code: 'surface_registry_load_failed',
          severity: 'error',
          message: formatError(error),
        },
      ],
      helpCommands,
      registeredCommands: [],
      conceptDocuments: [],
      registeredConcepts: [],
      registry: {
        schemaVersion: null,
        commandsPath: paths.commandsPath,
        conceptsPath: paths.conceptsPath,
      },
    };
  }

  const effectivePackageRoot = options.packageRoot ?? (options.registry ? null : dirname(dirname(registry.commandsPath)));
  const publicDocuments = options.publicDocuments ?? (effectivePackageRoot ? readPublicSurfaceDocuments(effectivePackageRoot) : []);
  const registeredCommandsByName = new Map(registry.commands.map((entry) => [entry.name, entry]));
  const visibleRegisteredCommands = registry.commands
    .filter(isVisibleRegisteredCommand)
    .map((entry) => entry.name);
  const helpCommandSet = new Set(helpCommands);

  const issues: SurfaceCheckIssue[] = [];
  for (const command of helpCommands) {
    const registeredCommand = registeredCommandsByName.get(command);
    if (!registeredCommand) {
      issues.push({
        code: 'unregistered_help_command',
        severity: 'error',
        command,
        message: `${command} is exposed in default help but missing from surface/commands.yml`,
      });
      continue;
    }
    if (registeredCommand.hidden) {
      issues.push({
        code: 'hidden_help_command',
        severity: 'error',
        command,
        message: `${command} is exposed in default help but marked hidden in surface/commands.yml`,
      });
    }
  }

  for (const command of visibleRegisteredCommands) {
    if (!helpCommandSet.has(command)) {
      issues.push({
        code: 'registered_command_not_in_help',
        severity: 'error',
        command,
        message: `${command} is registered as visible but absent from default help`,
      });
    }
  }
  issues.push(...checkConceptDocuments(registry, publicDocuments));

  const helpErrorCodes = new Set(['unregistered_help_command', 'hidden_help_command', 'registered_command_not_in_help']);
  const conceptErrorCodes = new Set(['unregistered_public_concept', 'non_public_concept_declared', 'non_public_concept_in_public_docs']);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const helpErrors = errors.filter((issue) => helpErrorCodes.has(issue.code));
  const conceptErrors = errors.filter((issue) => conceptErrorCodes.has(issue.code));
  const defaultHelpStatus: SurfaceCheckStatus = helpErrors.length > 0 ? 'failed' : 'passed';
  const conceptStatus: SurfaceCheckStatus = conceptErrors.length > 0 ? 'failed' : 'passed';
  const status: SurfaceCheckStatus = errors.length > 0 ? 'failed' : 'passed';

  return {
    status,
    checks: [
      {
        name: 'surface-registry-load',
        status: 'passed',
        detail: `schema v${registry.schemaVersion}, ${registry.commands.length} commands and ${registry.concepts.length} concepts registered`,
      },
      {
        name: 'default-help-command-registry',
        status: defaultHelpStatus,
        detail: `${helpCommands.length} default-help command(s), ${helpErrors.length} error(s)`,
      },
      {
        name: 'public-doc-concept-registry',
        status: conceptStatus,
        detail: `${publicDocuments.length} public doc(s), ${conceptErrors.length} concept error(s)`,
      },
    ],
    issues,
    helpCommands,
    registeredCommands: registry.commands.map((entry) => entry.name).sort((a, b) => a.localeCompare(b)),
    conceptDocuments: publicDocuments.map((document) => document.path),
    registeredConcepts: registry.concepts.map((entry) => entry.term).sort((a, b) => a.localeCompare(b)),
    registry: {
      schemaVersion: registry.schemaVersion,
      commandsPath: registry.commandsPath,
      conceptsPath: registry.conceptsPath,
    },
  };
}
