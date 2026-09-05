import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function loadRalplanInstructions(root = process.cwd()): string {
  const entrypoint = resolve(root, 'skills/ralplan/SKILL.md');
  const alias = readFileSync(entrypoint, 'utf-8');
  const targets = [...alias.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => match[1]);
  assert.deepEqual(targets, ['../plan/SKILL.md', 'references/consensus-boundary.md']);
  return [alias, ...targets.map((target) => readFileSync(resolve(dirname(entrypoint), target), 'utf-8'))].join('\n');
}
