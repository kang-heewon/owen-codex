import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listTrackedAgentSurfaces, loadSurface } from './prompt-guidance-test-helpers.js';

function expectPatterns(path: string, patterns: RegExp[]): void {
  const content = loadSurface(path);
  for (const pattern of patterns) {
    assert.match(content, pattern, `${path} missing required pattern: ${pattern}`);
  }
}

describe('explore + sparkshell guidance contract', () => {
  it('keeps AGENTS root and template aligned on supported repository-lookup routing and opt-in sparkshell guidance without the removed explore command', () => {
    const requiredPatterns = [
      /normal Codex repository inspection/i,
      /owx sparkshell --tmux-pane/i,
      /explicit opt-?in/i,
      /When to use what/i,
    ];

    for (const surface of listTrackedAgentSurfaces()) {
      const content = loadSurface(surface);
      expectPatterns(surface, requiredPatterns);
      assert.doesNotMatch(content, /owx explore/i, `${surface} still references the removed owx explore command`);
      assert.doesNotMatch(content, /USE_OWX_EXPLORE_CMD/i, `${surface} still references the deprecated USE_OWX_EXPLORE_CMD override`);
    }
  });

  it('keeps explore surfaces explicit about richer-path fallback', () => {
    expectPatterns('prompts/explore.md', [
      /`owx explore --prompt \.\.\.` is deprecated/i,
      /compatibility-only/i,
      /richer normal path/i,
    ]);

    expectPatterns('prompts/explore-harness.md', [
      /simple read-only repository lookup tasks/i,
      /deprecated and compatibility-only/i,
      /richer normal path/i,
    ]);
  });

  it('keeps execution and planning surfaces explicit about deprecated explore routing', () => {
    for (const surface of [
      'prompts/planner.md',
      'prompts/executor.md',
      'prompts/sisyphus-lite.md',
      'skills/deep-interview/SKILL.md',
      'skills/plan/SKILL.md',
      'skills/ralplan/SKILL.md',
      'skills/ralph/SKILL.md',
    ]) {
      expectPatterns(surface, [
        /`owx explore` is deprecated/i,
        /normal repository inspection|normal Codex repository inspection/i,
        /owx sparkshell/i,
      ]);
    }
  });

  it('keeps sparkshell guidance explicit opt-in and preserves raw qa or tmux evidence', () => {
    expectPatterns('prompts/qa-tester.md', [
      /optional operator aid/i,
      /does not replace raw `tmux capture-pane` evidence/i,
      /explicit opt-?in/i,
    ]);

    expectPatterns('skills/team/SKILL.md', [
      /owx sparkshell --tmux-pane/i,
      /explicit opt-?in/i,
      /raw `tmux capture-pane` evidence/i,
    ]);
  });
});
