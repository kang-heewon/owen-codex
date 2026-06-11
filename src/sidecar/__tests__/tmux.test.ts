import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSidecarTmuxSplitArgs, buildSidecarWatchCommand, launchSidecarTmuxPane } from '../tmux.js';

describe('sidecar tmux launcher', () => {
  it('builds a detached horizontal right-side split running watch mode', () => {
    const args = buildSidecarTmuxSplitArgs({ cwd: '/repo', teamName: 'demo-team', width: 52, sessionId: 'sess 1', owxBin: '/repo/dist/cli/owx.js' });
    assert.deepEqual(args.slice(0, 6), ['split-window', '-h', '-d', '-l', '52', '-c']);
    assert.equal(args[6], '/repo');
    assert.equal(args[8], '-F');
    assert.equal(args[9], '#{pane_id}');
    assert.match(args[10], /OWX_SESSION_ID='sess 1'/);
    assert.ok(args[10].includes(`'${process.execPath}' '/repo/dist/cli/owx.js' sidecar 'demo-team' --watch --width 52`));
  });

  it('uses a safe minimum sidecar width and parses the new pane id', () => {
    const command = buildSidecarWatchCommand({ cwd: '/repo', teamName: 'demo', width: 10, owxBin: '/repo/owx.js' });
    assert.match(command, /--width 48$/);

    const paneId = launchSidecarTmuxPane(
      { cwd: '/repo', teamName: 'demo', width: 48, owxBin: '/repo/owx.js' },
      (args) => {
        assert.equal(args[0], 'split-window');
        return '%42\n';
      },
    );
    assert.equal(paneId, '%42');
  });

  it('returns null when tmux launch throws', () => {
    const paneId = launchSidecarTmuxPane(
      { cwd: '/repo', teamName: 'demo', width: 48, owxBin: '/repo/owx.js' },
      () => {
        throw new Error('tmux unavailable');
      },
    );
    assert.equal(paneId, null);
  });
});
