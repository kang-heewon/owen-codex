import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  comparePlanningArtifactPaths,
  parsePlanningArtifactFileName,
  planningArtifactSlug,
  selectLatestPlanningArtifactPath,
  selectMatchingTestSpecsForPrd,
} from './artifact-names.js';
import { collectMarkdownVisibleMatches } from './markdown-structure.js';

const PRD_PATTERN = /^prd-.*\.md$/i;
const TEST_SPEC_PATTERN = /^test-?spec-.*\.md$/i;
const DEEP_INTERVIEW_SPEC_PATTERN = /^deep-interview-.*\.md$/i;
const APPROVED_REPOSITORY_CONTEXT_MAX_CHARS = 4_000;
const APPROVED_REPOSITORY_CONTEXT_MAX_LINES = 80;

interface PlanningArtifactSelectionBase {
  prdPath: string | null;
  testSpecPaths: string[];
  deepInterviewSpecPaths: string[];
}

export interface PlanningArtifacts {
  plansDir: string;
  specsDir: string;
  prdPaths: string[];
  testSpecPaths: string[];
  deepInterviewSpecPaths: string[];
}

export interface ApprovedRepositoryContextSummary {
  sourcePath: string;
  content: string;
  truncated: boolean;
}

export interface ApprovedPlanContext {
  sourcePath: string;
  testSpecPaths: string[];
  deepInterviewSpecPaths: string[];
  repositoryContextSummary?: ApprovedRepositoryContextSummary;
}

export interface ApprovedExecutionLaunchHint extends ApprovedPlanContext {
  mode: 'ralph';
  command: string;
  task: string;
}

export interface LatestPlanningArtifactSelection {
  prdPath: string | null;
  testSpecPaths: string[];
  deepInterviewSpecPaths: string[];
}

interface ApprovedExecutionLaunchHintReadOptions {
  prdPath?: string;
  task?: string;
  command?: string;
}

export type ApprovedExecutionLaunchHintOutcome =
  | { status: 'absent' }
  | { status: 'ambiguous' }
  | { status: 'resolved'; hint: ApprovedExecutionLaunchHint };


function readMatchingPaths(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  try {
    return readdirSync(dir)
      .filter((file) => pattern.test(file))
      .sort(comparePlanningArtifactPaths)
      .map((file) => join(dir, file));
  } catch {
    return [];
  }
}

export function readPlanningArtifacts(cwd: string): PlanningArtifacts {
  const plansDir = join(cwd, '.owx', 'plans');
  const specsDir = join(cwd, '.owx', 'specs');

  return {
    plansDir,
    specsDir,
    prdPaths: readMatchingPaths(plansDir, PRD_PATTERN),
    testSpecPaths: readMatchingPaths(plansDir, TEST_SPEC_PATTERN),
    deepInterviewSpecPaths: readMatchingPaths(specsDir, DEEP_INTERVIEW_SPEC_PATTERN)
      .filter((path) => parsePlanningArtifactFileName(path)?.kind === 'deep-interview'),
  };
}

export function isPlanningComplete(artifacts: PlanningArtifacts): boolean {
  const selection = selectPlanningArtifactsBase(artifacts);
  return Boolean(selection.prdPath) && selection.testSpecPaths.length > 0;
}

export function decodeApprovedExecutionQuotedValue(raw: string): string | null {
  const normalized = raw.trim();
  if (!normalized) return null;
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    return normalized.slice(1, -1).replace(/\\"/g, '"');
  }
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    return normalized.slice(1, -1).replace(/\\'/g, "'");
  }
  return null;
}

function artifactPathSuffix(path: string, prefixPattern: RegExp): string | null {
  const file = basename(path);
  const match = file.match(prefixPattern);
  return match?.groups?.slug ?? null;
}

function selectDeepInterviewSpecPathsForSlug(paths: readonly string[], slug: string | null): string[] {
  if (!slug) return [];
  return paths
    .filter((path) => planningArtifactSlug(path, 'deep-interview') === slug)
    .sort(comparePlanningArtifactPaths);
}

function selectPlanningArtifactsBase(
  artifacts: PlanningArtifacts,
  prdPath?: string,
): PlanningArtifactSelectionBase {
  const requestedPrdPath = prdPath == null
    ? null
    : resolveRequestedPrdPath(artifacts, prdPath);
  const selectedPrdPath = prdPath == null
    ? selectLatestPlanningArtifactPath(artifacts.prdPaths)
    : requestedPrdPath;
  const slug = selectedPrdPath
    ? planningArtifactSlug(selectedPrdPath, 'prd')
    : null;

  return {
    prdPath: selectedPrdPath,
    testSpecPaths: selectMatchingTestSpecsForPrd(selectedPrdPath, artifacts.testSpecPaths),
    deepInterviewSpecPaths: selectDeepInterviewSpecPathsForSlug(artifacts.deepInterviewSpecPaths, slug),
  };
}

function resolveRequestedPrdPath(
  artifacts: PlanningArtifacts,
  rawPrdPath: string,
): string | null {
  const requested = rawPrdPath.trim();
  if (!requested) {
    return null;
  }
  if (artifacts.prdPaths.includes(requested)) {
    return requested;
  }

  const repoRoot = dirname(dirname(artifacts.plansDir));
  const canonicalByResolvedPath = new Map(
    artifacts.prdPaths.map((artifactPath) => [resolve(artifactPath), artifactPath]),
  );
  const candidatePaths = isAbsolute(requested)
    ? [resolve(requested)]
    : [
      resolveRelativePathWithinRoot(repoRoot, requested, repoRoot),
      resolveRelativePathWithinRoot(artifacts.plansDir, requested, repoRoot),
    ];

  for (const candidatePath of candidatePaths) {
    if (!candidatePath) {
      continue;
    }
    const canonical = canonicalByResolvedPath.get(candidatePath);
    if (canonical) {
      return canonical;
    }
  }
  return null;
}

function resolveRelativePathWithinRoot(
  baseDir: string,
  rawPath: string,
  rootDir: string,
): string | null {
  const resolvedRootDir = resolve(rootDir);
  let currentDir = resolve(baseDir);

  for (const segment of rawPath.split(/[\\/]+/)) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (currentDir === resolvedRootDir) {
        return null;
      }
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) {
        return null;
      }
      currentDir = parentDir;
      continue;
    }
    currentDir = join(currentDir, segment);
  }

  return resolve(currentDir);
}

function selectPlanningArtifacts(
  artifacts: PlanningArtifacts,
  prdPath?: string,
): LatestPlanningArtifactSelection {
  return selectPlanningArtifactsBase(artifacts, prdPath);
}

function boundedRepositoryContextSummary(sourcePath: string, content: string): ApprovedRepositoryContextSummary | null {
  const normalizedLines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
  const trimmed = normalizedLines.join('\n').trim();
  if (!trimmed) return null;

  const limitedLines = normalizedLines.slice(0, APPROVED_REPOSITORY_CONTEXT_MAX_LINES);
  const lineTruncated = normalizedLines.length > limitedLines.length;
  let limited = limitedLines.join('\n').trim();
  let charTruncated = false;
  if (limited.length > APPROVED_REPOSITORY_CONTEXT_MAX_CHARS) {
    limited = limited.slice(0, APPROVED_REPOSITORY_CONTEXT_MAX_CHARS).trimEnd();
    charTruncated = true;
  }
  return { sourcePath, content: limited, truncated: lineTruncated || charTruncated };
}

function extractApprovedRepositoryContextSection(sourcePath: string, content: string): ApprovedRepositoryContextSummary | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+Approved Repository Context Summary\s*$/i.test(line.trim()));
  if (headingIndex < 0) return null;
  const headingLevel = lines[headingIndex].match(/^(#+)/)?.[1].length ?? 1;
  const body: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+/);
    if (heading && heading[1].length <= headingLevel) break;
    body.push(lines[index]);
  }
  return boundedRepositoryContextSummary(sourcePath, body.join('\n'));
}

function readApprovedRepositoryContextSummary(
  artifacts: PlanningArtifacts,
  prdPath: string,
  planSlug: string | null,
  prdContent: string,
): ApprovedRepositoryContextSummary | null {
  if (!planSlug) return extractApprovedRepositoryContextSection(prdPath, prdContent);
  const repositoryContextPath = join(artifacts.plansDir, `repo-context-${planSlug}.md`);
  if (existsSync(repositoryContextPath)) {
    try {
      const repositoryContext = boundedRepositoryContextSummary(repositoryContextPath, readFileSync(repositoryContextPath, 'utf-8'));
      if (repositoryContext) return repositoryContext;
    } catch {
      // Fall through to an inline approved PRD section when the repository context is unreadable.
    }
  }
  return extractApprovedRepositoryContextSection(prdPath, prdContent);
}

function readApprovedPlanText(
  cwd: string,
  options: ApprovedExecutionLaunchHintReadOptions = {},
  artifacts: PlanningArtifacts = readPlanningArtifacts(cwd),
): { content: string; context: ApprovedPlanContext } | null {
  const selection = selectPlanningArtifacts(artifacts, options.prdPath);
  const latestPrdPath = selection.prdPath;
  if (!latestPrdPath || selection.testSpecPaths.length === 0 || !existsSync(latestPrdPath)) {
    return null;
  }

  try {
    const content = readFileSync(latestPrdPath, 'utf-8');
    const planSlug = artifactPathSuffix(latestPrdPath, /^prd-(?<slug>.*)\.md$/i);
    const repositoryContextSummary = readApprovedRepositoryContextSummary(artifacts, latestPrdPath, planSlug, content);
    return {
      content,
      context: {
        sourcePath: latestPrdPath,
        testSpecPaths: selection.testSpecPaths,
        deepInterviewSpecPaths: selection.deepInterviewSpecPaths,
        ...(repositoryContextSummary ? { repositoryContextSummary } : {}),
      },
    };
  } catch {
    return null;
  }
}

export function selectLatestPlanningArtifacts(
  artifacts: PlanningArtifacts,
): LatestPlanningArtifactSelection {
  return selectPlanningArtifacts(artifacts);
}

export function readLatestPlanningArtifacts(cwd: string): LatestPlanningArtifactSelection {
  return selectLatestPlanningArtifacts(readPlanningArtifacts(cwd));
}
type LaunchHintSelection =
  | { status: 'no-match' }
  | { status: 'ambiguous' }
  | { status: 'unique'; match: RegExpMatchArray; task: string };

const RALPH_LAUNCH_HINT_PATTERN_SOURCE =
  String.raw`(?<command>(?:owx\s+ralph|\$ralph)\s+(?<task>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))`;

function launchHintPattern(): RegExp {
  return new RegExp(RALPH_LAUNCH_HINT_PATTERN_SOURCE, 'gi');
}

function launchHintExactPattern(): RegExp {
  return new RegExp(`^${RALPH_LAUNCH_HINT_PATTERN_SOURCE}$`, 'i');
}

function normalizeLaunchHintCommandFromMatch(
  match: RegExpMatchArray | null | undefined,
): string | null {
  const rawCommand = match?.groups?.command?.trim();
  const taskToken = match?.groups?.task?.trim();
  if (!rawCommand || !taskToken) return null;
  const prefix = /^\$ralph\b/i.test(rawCommand) ? '$ralph' : 'owx ralph';
  return `${prefix} ${taskToken}`;
}

function normalizeLaunchHintCommand(command: string | undefined): string | undefined {
  const trimmed = command?.trim();
  if (!trimmed) return undefined;
  return normalizeLaunchHintCommandFromMatch(trimmed.match(launchHintExactPattern())) ?? trimmed;
}

function selectLaunchHintMatch(
  matches: RegExpMatchArray[],
  normalizedTask?: string,
  normalizedCommand?: string,
): LaunchHintSelection {
  const exactCommand = normalizeLaunchHintCommand(normalizedCommand);
  const decoded = matches.flatMap((match) => {
    const task = match.groups?.task ? decodeApprovedExecutionQuotedValue(match.groups.task) : null;
    const command = normalizeLaunchHintCommandFromMatch(match);
    if (!task || !command) return [];
    return [{ match, task, command }];
  });

  const selected = normalizedCommand
    ? decoded.filter((entry) => entry.command === exactCommand)
    : normalizedTask
      ? decoded.filter((entry) => entry.task.trim() === normalizedTask)
      : decoded;
  if (selected.length === 0) return { status: 'no-match' };
  if (selected.length > 1) return { status: 'ambiguous' };
  return { status: 'unique', match: selected[0]!.match, task: selected[0]!.task };
}

function orderedPrdPathsNewestFirst(prdPaths: readonly string[]): string[] {
  return [...prdPaths].sort(comparePlanningArtifactPaths).reverse();
}

function readApprovedExecutionLaunchHintOutcomeForPrdPath(
  cwd: string,
  prdPath: string,
  options: ApprovedExecutionLaunchHintReadOptions = {},
  artifacts: PlanningArtifacts = readPlanningArtifacts(cwd),
): ApprovedExecutionLaunchHintOutcome {
  const approvedPlan = readApprovedPlanText(cwd, { ...options, prdPath }, artifacts);
  if (!approvedPlan) return { status: 'absent' };

  const selected = selectLaunchHintMatch(
    collectMarkdownVisibleMatches(approvedPlan.content, launchHintPattern()),
    options.task?.trim(),
    options.command?.trim(),
  );
  if (selected.status === 'ambiguous') return { status: 'ambiguous' };
  if (selected.status !== 'unique' || !selected.match.groups) return { status: 'absent' };

  return {
    status: 'resolved',
    hint: {
      mode: 'ralph',
      command: normalizeLaunchHintCommandFromMatch(selected.match) ?? selected.match.groups.command,
      task: selected.task,
      ...approvedPlan.context,
    },
  };
}

function isApprovedExecutionLaunchHintReady(hint: ApprovedExecutionLaunchHint): boolean {
  return hint.testSpecPaths.length > 0 && existsSync(hint.sourcePath);
}

function resolveOlderReusableSameLineageHint(
  cwd: string,
  artifacts: PlanningArtifacts,
  latestPrdPath: string,
  task: string,
): ApprovedExecutionLaunchHintOutcome {
  const ordered = [...artifacts.prdPaths].sort(comparePlanningArtifactPaths);
  const latestIndex = ordered.lastIndexOf(latestPrdPath);
  for (let index = latestIndex - 1; index >= 0; index -= 1) {
    const outcome = readApprovedExecutionLaunchHintOutcomeForPrdPath(
      cwd,
      ordered[index]!,
      { task },
      artifacts,
    );
    if (outcome.status === 'ambiguous') return outcome;
    if (outcome.status === 'resolved' && isApprovedExecutionLaunchHintReady(outcome.hint)) {
      return outcome;
    }
  }
  return { status: 'absent' };
}

export function readApprovedExecutionLaunchHintOutcome(
  cwd: string,
  mode: 'ralph',
  options: ApprovedExecutionLaunchHintReadOptions = {},
): ApprovedExecutionLaunchHintOutcome {
  if (mode !== 'ralph') return { status: 'absent' };
  const artifacts = readPlanningArtifacts(cwd);
  if (options.prdPath) {
    return readApprovedExecutionLaunchHintOutcomeForPrdPath(cwd, options.prdPath, options, artifacts);
  }

  const normalizedTask = options.task?.trim();
  const normalizedCommand = options.command?.trim();
  if (!normalizedTask && !normalizedCommand) {
    const latestPrdPath = selectLatestPlanningArtifactPath(artifacts.prdPaths);
    if (!latestPrdPath) return { status: 'absent' };
    const latest = readApprovedExecutionLaunchHintOutcomeForPrdPath(cwd, latestPrdPath, options, artifacts);
    if (latest.status !== 'resolved' || isApprovedExecutionLaunchHintReady(latest.hint)) return latest;
    const fallback = resolveOlderReusableSameLineageHint(cwd, artifacts, latestPrdPath, latest.hint.task);
    return fallback.status === 'absent' ? latest : fallback;
  }

  let newestNonreadyHint: ApprovedExecutionLaunchHint | null = null;
  for (const prdPath of orderedPrdPathsNewestFirst(artifacts.prdPaths)) {
    const outcome = readApprovedExecutionLaunchHintOutcomeForPrdPath(cwd, prdPath, options, artifacts);
    if (outcome.status === 'ambiguous') return outcome;
    if (outcome.status !== 'resolved') continue;
    if (isApprovedExecutionLaunchHintReady(outcome.hint)) return outcome;
    newestNonreadyHint ??= outcome.hint;
  }
  return newestNonreadyHint ? { status: 'resolved', hint: newestNonreadyHint } : { status: 'absent' };
}

export function readApprovedExecutionLaunchHint(
  cwd: string,
  mode: 'ralph',
  options: ApprovedExecutionLaunchHintReadOptions = {},
): ApprovedExecutionLaunchHint | null {
  const outcome = readApprovedExecutionLaunchHintOutcome(cwd, mode, options);
  if (outcome.status !== 'resolved' || !isApprovedExecutionLaunchHintReady(outcome.hint)) return null;
  return outcome.hint;
}
