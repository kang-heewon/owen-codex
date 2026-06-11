import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import {
  teamRuntimeSessionPath,
  teamRuntimeTeamRoot,
  teamRuntimeTeamsRoot,
  teamStartupTimingPath,
} from '../runtime.js';

describe('team runtime boxed state path helpers', () => {
  it('routes runtime-owned team state paths through OWX_ROOT without changing source cwd semantics', () => {
    const previousRoot = process.env.OWX_ROOT;
    const previousStateRoot = process.env.OWX_STATE_ROOT;
    const previousTeamStateRoot = process.env.OWX_TEAM_STATE_ROOT;
    try {
      process.env.OWX_ROOT = '/tmp/box';
      delete process.env.OWX_STATE_ROOT;
      delete process.env.OWX_TEAM_STATE_ROOT;

      assert.equal(teamRuntimeTeamsRoot('/tmp/source'), '/tmp/box/.owx/state/team');
      assert.equal(teamRuntimeTeamRoot('team-a', '/tmp/source'), '/tmp/box/.owx/state/team/team-a');
      assert.equal(
        teamStartupTimingPath('team-a', '/tmp/source'),
        '/tmp/box/.owx/state/team/team-a/startup-timing.json',
      );
      assert.equal(teamRuntimeSessionPath('/tmp/source'), '/tmp/box/.owx/state/session.json');
      assert.equal(join('/tmp/source', 'README.md'), '/tmp/source/README.md');

      process.env.OWX_TEAM_STATE_ROOT = '/tmp/explicit-team-state';
      assert.equal(teamRuntimeTeamsRoot('/tmp/source'), '/tmp/explicit-team-state/team');
      assert.equal(
        teamStartupTimingPath('team-a', '/tmp/source'),
        '/tmp/explicit-team-state/team/team-a/startup-timing.json',
      );
    } finally {
      if (typeof previousRoot === 'string') process.env.OWX_ROOT = previousRoot;
      else delete process.env.OWX_ROOT;
      if (typeof previousStateRoot === 'string') process.env.OWX_STATE_ROOT = previousStateRoot;
      else delete process.env.OWX_STATE_ROOT;
      if (typeof previousTeamStateRoot === 'string') process.env.OWX_TEAM_STATE_ROOT = previousTeamStateRoot;
      else delete process.env.OWX_TEAM_STATE_ROOT;
    }
  });
});
