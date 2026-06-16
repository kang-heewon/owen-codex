#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export interface FallbackAuditFinding {
  path: string;
  line: number;
  endLine: number;
  rule: string;
  message: string;
  excerpt: string;
}

const CODE_FILE_PATTERN = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
const IGNORED_PATH_SEGMENTS = new Set(['node_modules', 'dist', 'coverage', '.git', '__tests__', 'fixtures']);

interface Rule {
  id: string;
  message: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    id: 'empty-catch',
    message: 'Empty catch blocks hide failure evidence. Surface the error or prove why it is intentionally ignored.',
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
  },
  {
    id: 'catch-default-return',
    message: 'Returning a silent default from catch can disguise failure as success.',
    pattern: /catch\s*(?:\([^)]*\))?\s*\{[^{}]{0,240}\breturn\s+(?:\[\]|\{\}|null|undefined|false|true|0|""|'')\s*;?[^{}]{0,80}\}/gs,
  },
  {
    id: 'void-catch',
    message: 'Discarding catch evidence with void/default handling needs explicit justification.',
    pattern: /catch\s*\([^)]*\)\s*\{[^{}]{0,200}\b(?:void\s+\w+|return\s+void\s+0)\s*;?[^{}]{0,80}\}/gs,
  },
];

function lineForIndex(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function cleanExcerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function auditText(path: string, text: string): FallbackAuditFinding[] {
  const findings: FallbackAuditFinding[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        path,
        line: lineForIndex(text, match.index ?? 0),
        endLine: lineForIndex(text, (match.index ?? 0) + match[0].length),
        rule: rule.id,
        message: rule.message,
        excerpt: cleanExcerpt(match[0]),
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

function isIgnoredPath(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
}

function changedCodeFiles(root: string): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD', '--'],
    { cwd: root, encoding: 'utf-8' },
  );
  return output
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter((path) => path.length > 0 && CODE_FILE_PATTERN.test(path) && !isIgnoredPath(path));
}

export function parseChangedLinesFromDiff(diff: string): Map<string, Set<number>> {
  const changedLines = new Map<string, Set<number>>();
  let currentPath: string | null = null;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      currentPath = target.startsWith('b/') ? target.slice(2) : null;
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk || currentPath === null) continue;

    const start = Number.parseInt(hunk[1] ?? '0', 10);
    const count = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
    if (start <= 0 || count <= 0) continue;

    let lines = changedLines.get(currentPath);
    if (lines === undefined) {
      lines = new Set<number>();
      changedLines.set(currentPath, lines);
    }
    for (let offset = 0; offset < count; offset += 1) {
      lines.add(start + offset);
    }
  }

  return changedLines;
}

function changedCodeFileLines(root: string): Map<string, Set<number>> {
  const output = execFileSync(
    'git',
    ['diff', '--unified=0', '--diff-filter=ACMR', 'HEAD', '--'],
    { cwd: root, encoding: 'utf-8' },
  );
  const changedLines = parseChangedLinesFromDiff(output);
  for (const path of Array.from(changedLines.keys())) {
    if (!CODE_FILE_PATTERN.test(path) || isIgnoredPath(path)) changedLines.delete(path);
  }
  return changedLines;
}

function walkCodeFiles(root: string, dir: string, out: string[]): void {
  const absolute = join(root, dir);
  if (!existsSync(absolute) || isIgnoredPath(dir)) return;
  const stats = statSync(absolute);
  if (stats.isFile()) {
    if (CODE_FILE_PATTERN.test(dir) && !dir.endsWith('.d.ts')) out.push(dir);
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(absolute)) {
    walkCodeFiles(root, join(dir, entry), out);
  }
}

function resolveTargetFiles(root: string, args: string[]): string[] {
  if (args.includes('--all')) {
    const out: string[] = [];
    walkCodeFiles(root, 'src', out);
    return out.sort();
  }

  const explicit = args.filter((arg) => !arg.startsWith('-'));
  if (explicit.length > 0) {
    return explicit
      .map((path) => relative(root, resolve(root, path)))
      .filter((path) => CODE_FILE_PATTERN.test(path) && !isIgnoredPath(path));
  }

  return changedCodeFiles(root);
}

interface AuditFilesOptions {
  changedLinesByPath?: Map<string, Set<number>>;
}

function overlapsChangedLine(finding: FallbackAuditFinding, changedLines: Set<number>): boolean {
  for (let line = finding.line; line <= finding.endLine; line += 1) {
    if (changedLines.has(line)) return true;
  }
  return false;
}

export function auditFiles(root: string, files: string[], options: AuditFilesOptions = {}): FallbackAuditFinding[] {
  return files.flatMap((path) => {
    const absolute = join(root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return [];
    const findings = auditText(path, readFileSync(absolute, 'utf-8'));
    if (options.changedLinesByPath === undefined) return findings;
    const changedLines = options.changedLinesByPath.get(path);
    if (changedLines === undefined) return [];
    return findings.filter((finding) => overlapsChangedLine(finding, changedLines));
  });
}

function main(): void {
  const root = process.cwd();
  const args = process.argv.slice(2);
  const files = resolveTargetFiles(root, args);
  const scansFullFiles = args.includes('--all') || args.some((arg) => !arg.startsWith('-'));
  const findings = auditFiles(root, files, {
    changedLinesByPath: scansFullFiles ? undefined : changedCodeFileLines(root),
  });

  if (findings.length === 0) {
    console.log(`fallback-audit: no suspicious fallback patterns in ${files.length} file(s)`);
    return;
  }

  console.error(`fallback-audit: found ${findings.length} suspicious fallback pattern(s)`);
  for (const finding of findings) {
    console.error(`${finding.path}:${finding.line} [${finding.rule}] ${finding.message}`);
    console.error(`  ${finding.excerpt}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
