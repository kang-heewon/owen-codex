import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractHelpCommands, runSurfaceCheck } from '../check.js';
import {
  readSurfaceConcepts,
  readSurfaceCommands,
  readSurfaceRegistry,
  type SurfaceCommandEntry,
  type SurfaceConceptEntry,
  type SurfaceRegistry,
} from '../registry.js';

type MinimalCommand = Pick<SurfaceCommandEntry, 'name' | 'tier' | 'status' | 'hidden' | 'purpose'>
  & Partial<SurfaceCommandEntry>;
type MinimalConcept = Pick<SurfaceConceptEntry, 'term' | 'public' | 'status' | 'definition'>
  & Partial<SurfaceConceptEntry>;

function materializeCommand(command: MinimalCommand): SurfaceCommandEntry {
  return {
    visibility: command.tier === 'internal' || command.status === 'internal'
      ? 'internal'
      : command.status === 'legacy'
        ? 'legacy'
        : command.status === 'deprecated'
          ? 'deprecated'
          : command.tier === 'advanced'
            ? 'advanced'
            : 'default',
    owner: 'surface-owner',
    docs: {},
    nested_help: { required: !command.hidden },
    ...command,
  };
}

function materializeConcept(concept: MinimalConcept): SurfaceConceptEntry {
  return {
    aliases: [],
    allowed_in: [],
    forbidden_in: [],
    ...concept,
  };
}

function registry(commands: MinimalCommand[], concepts: MinimalConcept[] = [
  {
    term: 'Surface',
    public: true,
    status: 'beta',
    definition: 'User-visible product contract.',
  },
]): SurfaceRegistry {
  return {
    schemaVersion: 1,
    commandsPath: 'memory:commands',
    conceptsPath: 'memory:concepts',
    commands: commands.map(materializeCommand),
    concepts: concepts.map(materializeConcept),
  };
}

describe('surface check', () => {
  it('loads the repository registry', () => {
    const loaded = readSurfaceRegistry();
    const surfaceCommand = loaded.commands.find((command) => command.name === 'owx surface');
    const surfaceConcept = loaded.concepts.find((concept) => concept.term === 'Surface');
    assert.equal(surfaceCommand?.visibility, 'default');
    assert.equal(surfaceCommand?.owner, 'surface-owner');
    assert.equal(surfaceCommand?.docs.canonical, 'COMMANDS.md#owx-surface');
    assert.equal(surfaceCommand?.nested_help.required, true);
    assert.equal(surfaceCommand?.output_contract, 'schemas/outputs/surface-check.schema.json');
    assert.equal(surfaceConcept?.public, true);
    assert.deepEqual(surfaceConcept?.aliases, ['product surface']);
    assert.ok(surfaceConcept?.allowed_in.includes('public-docs'));
  });

  it('extracts top-level help commands and dedupes subcommand variants', () => {
    const commands = extractHelpCommands([
      'Usage:',
      '  owx update    Install the stable channel now',
      '  owx update --stable',
      '                Install stable',
      '  owx exec inject <session-id>',
      '  --direct       Launch directly',
      '  owx           Launch Codex CLI',
    ].join('\n'));

    assert.deepEqual(commands, ['owx', 'owx exec', 'owx update']);
  });

  it('passes when default help commands are registered', () => {
    const result = runSurfaceCheck({
      helpText: '  owx surface   Inspect surface\n',
      registry: registry([
        {
          name: 'owx surface',
          tier: 'core',
          status: 'beta',
          hidden: false,
          purpose: 'Inspect surface.',
        },
      ]),
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.issues.some((issue) => issue.severity === 'error'), false);
    assert.ok(result.checks.some((check) => check.name === 'public-doc-concept-registry' && check.status === 'passed'));
  });

  it('fails when default help exposes an unregistered command', () => {
    const result = runSurfaceCheck({
      helpText: '  owx drift   Accidental command\n',
      registry: registry([]),
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.issues[0]?.code, 'unregistered_help_command');
    assert.equal(result.issues[0]?.command, 'owx drift');
  });

  it('does not warn when hidden commands are absent from default help', () => {
    const result = runSurfaceCheck({
      helpText: '',
      registry: registry([
        {
          name: 'owx internal',
          tier: 'internal',
          status: 'internal',
          hidden: true,
          purpose: 'Internal command.',
        },
      ]),
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.issues.length, 0);
  });

  it('fails when a visible registered command is absent from default help', () => {
    const result = runSurfaceCheck({
      helpText: '',
      registry: registry([
        {
          name: 'owx visible',
          tier: 'core',
          status: 'stable',
          hidden: false,
          purpose: 'Visible command.',
        },
      ]),
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.issues[0]?.code, 'registered_command_not_in_help');
    assert.equal(result.issues[0]?.severity, 'error');
    assert.equal(result.issues[0]?.command, 'owx visible');
  });

  it('fails when default help exposes a hidden command', () => {
    const result = runSurfaceCheck({
      helpText: '  owx internal   Internal command\n',
      registry: registry([
        {
          name: 'owx internal',
          tier: 'internal',
          status: 'internal',
          hidden: true,
          purpose: 'Internal command.',
        },
      ]),
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.issues[0]?.code, 'hidden_help_command');
    assert.equal(result.issues[0]?.command, 'owx internal');
  });

  it('returns structured failure results when registry files cannot load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owx-surface-missing-registry-'));
    const result = runSurfaceCheck({
      packageRoot: root,
      helpText: '  owx surface   Inspect surface\n',
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.checks[0]?.name, 'surface-registry-load');
    assert.equal(result.checks[0]?.status, 'failed');
    assert.equal(result.issues[0]?.code, 'surface_registry_load_failed');
    assert.equal(result.registry.schemaVersion, null);
    assert.match(result.registry.commandsPath, /surface\/commands\.yml$/);
  });

  it('passes registered public concept declarations in public docs', () => {
    const result = runSurfaceCheck({
      helpText: '',
      registry: registry([], [
        {
          term: 'Surface',
          public: true,
          status: 'stable',
          definition: 'User-visible product contract.',
        },
      ]),
      publicDocuments: [
        {
          path: 'CONCEPTS.md',
          text: 'Concept: Surface\n',
        },
      ],
    });

    assert.equal(result.status, 'passed');
    assert.deepEqual(result.conceptDocuments, ['CONCEPTS.md']);
  });

  it('fails when public docs declare an unregistered concept', () => {
    const result = runSurfaceCheck({
      helpText: '',
      registry: registry([]),
      publicDocuments: [
        {
          path: 'CONCEPTS.md',
          text: 'Concept: FlashWork\n',
        },
      ],
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.issues[0]?.code, 'unregistered_public_concept');
    assert.equal(result.issues[0]?.document, 'CONCEPTS.md');
    assert.equal(result.issues[0]?.term, 'FlashWork');
  });

  it('fails when public docs use non-public or deprecated concepts', () => {
    const result = runSurfaceCheck({
      helpText: '',
      registry: registry([], [
        {
          term: 'Work',
          public: true,
          status: 'stable',
          definition: 'Tracked user intent.',
        },
        {
          term: 'UltraGoal',
          public: false,
          status: 'legacy',
          definition: 'Legacy execution engine.',
          replaced_by: 'Work',
        },
      ]),
      publicDocuments: [
        {
          path: 'README.md',
          text: 'UltraGoal is the primary user concept.\n',
        },
      ],
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.issues[0]?.code, 'non_public_concept_in_public_docs');
    assert.equal(result.issues[0]?.term, 'UltraGoal');
  });

  it('rejects duplicate command registry entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owx-surface-'));
    const path = join(root, 'commands.yml');
    await mkdir(root, { recursive: true });
    await writeFile(path, [
      'schema_version: 1',
      'commands:',
      '  - name: "owx help"',
      '    tier: core',
      '    status: stable',
      '    hidden: false',
      '    purpose: "Show help."',
      '  - name: "owx help"',
      '    tier: core',
      '    status: stable',
      '    hidden: false',
      '    purpose: "Show help again."',
    ].join('\n'));

    assert.throws(() => readSurfaceCommands(path), /duplicate_command:owx help/);
  });

  it('loads expanded command and concept metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owx-surface-expanded-registry-'));
    const surfaceDir = join(root, 'surface');
    await mkdir(surfaceDir, { recursive: true });
    await writeFile(join(surfaceDir, 'commands.yml'), [
      'schema_version: 1',
      'commands:',
      '  - name: "owx surface"',
      '    tier: core',
      '    status: beta',
      '    hidden: false',
      '    visibility: default',
      '    owner: surface-owner',
      '    purpose: "Inspect surface."',
      '    docs:',
      '      canonical: "COMMANDS.md#owx-surface"',
      '      troubleshooting: "TROUBLESHOOTING.md#owx-surface"',
      '    nested_help:',
      '      required: true',
      '      expected_heading: "Usage: owx surface"',
      '    output_contract: "schemas/outputs/surface-check.schema.json"',
    ].join('\n'));
    await writeFile(join(surfaceDir, 'concepts.yml'), [
      'schema_version: 1',
      'concepts:',
      '  - term: "Surface"',
      '    public: true',
      '    status: beta',
      '    definition: "User-visible product contract."',
      '    aliases:',
      '      - "product surface"',
      '    allowed_in:',
      '      - "public-docs"',
      '    forbidden_in:',
      '      - "internal-only-docs"',
    ].join('\n'));

    const loaded = readSurfaceRegistry(root);
    assert.equal(loaded.commands[0]?.visibility, 'default');
    assert.equal(loaded.commands[0]?.docs.troubleshooting, 'TROUBLESHOOTING.md#owx-surface');
    assert.equal(loaded.commands[0]?.nested_help.expected_heading, 'Usage: owx surface');
    assert.equal(loaded.commands[0]?.output_contract, 'schemas/outputs/surface-check.schema.json');
    assert.deepEqual(loaded.concepts[0]?.aliases, ['product surface']);
    assert.deepEqual(loaded.concepts[0]?.allowed_in, ['public-docs']);
    assert.deepEqual(loaded.concepts[0]?.forbidden_in, ['internal-only-docs']);
  });

  it('rejects invalid command and concept metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owx-surface-invalid-metadata-'));
    const commandPath = join(root, 'commands.yml');
    const conceptPath = join(root, 'concepts.yml');
    await mkdir(root, { recursive: true });
    const base = [
      'schema_version: 1',
      'commands:',
      '  - name: "owx surface"',
      '    tier: core',
      '    status: beta',
      '    hidden: false',
      '    visibility: spotlight',
      '    purpose: "Inspect surface."',
    ];
    await writeFile(commandPath, base.join('\n'));
    assert.throws(() => readSurfaceCommands(commandPath), /0\.visibility/);

    await writeFile(commandPath, base.map((line) => (
      line === '    status: beta' ? '    status: preview' : line === '    visibility: spotlight' ? '    visibility: default' : line
    )).join('\n'));
    assert.throws(() => readSurfaceCommands(commandPath), /0\.status/);

    await writeFile(commandPath, [
      'schema_version: 1',
      'commands:',
      '  - name: "owx surface"',
      '    tier: core',
      '    status: beta',
      '    hidden: false',
      '    visibility: default',
      '    purpose: "Inspect surface."',
      '    docs:',
      '      canonical: "COMMANDS.md#owx-surface"',
      '      extra: "not supported"',
    ].join('\n'));
    assert.throws(() => readSurfaceCommands(commandPath), /0\.docs\.extra/);

    await writeFile(conceptPath, [
      'schema_version: 1',
      'concepts:',
      '  - term: "Surface"',
      '    public: true',
      '    status: preview',
      '    definition: "User-visible product contract."',
    ].join('\n'));
    assert.throws(() => readSurfaceConcepts(conceptPath), /0\.status/);
  });
});
