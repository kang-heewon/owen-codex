import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resolveHudWatchCwd, runWatchMode } from '../index.js';
import type { HudFlags, HudRenderContext } from '../types.js';

const WATCH_FLAGS: HudFlags = { watch: true, json: false };

function emptyCtx(): HudRenderContext {
  return {
    version: null,
    gitBranch: null,
    ralph: null,
    ultrawork: null,
    autopilot: null,
    ralplan: null,
    deepInterview: null,
    autoresearch: null,
    ultraqa: null,
    metrics: null,
    hudNotify: null,
    session: null,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

afterEach(() => { process.exitCode = undefined; });

describe('runWatchMode', () => {
  it('resolves a live cwd when the launch path is reused by another run', () => {
    const resolved = resolveHudWatchCwd('/home/tools/calc', {
      getCwd: () => '/home/tools/calc',
      readProcCwd: () => '/home/tools/calc.old',
      realpath: (path) => path === '/home/tools/calc' ? '/inode/new' : '/inode/old',
    });
    assert.equal(resolved, '/home/tools/calc.old');
  });

  it('keeps the launch cwd when live and launch paths resolve to the same directory', () => {
    const resolved = resolveHudWatchCwd('/workspace/link', {
      getCwd: () => '/workspace/link',
      readProcCwd: () => '/workspace/real',
      realpath: () => '/inode/project',
    });
    assert.equal(resolved, '/workspace/link');
  });

  it('rejects watch mode without a TTY', async () => {
    const errors: string[] = [];
    await runWatchMode('/tmp', WATCH_FLAGS, {
      isTTY: false,
      writeStderr: (text) => { errors.push(text); },
    });
    assert.equal(process.exitCode, 1);
    assert.deepEqual(errors, ['HUD watch mode requires a TTY\n']);
  });

  it('reads from the resolved cwd and restores the cursor on SIGINT', async () => {
    const writes: string[] = [];
    const seenCwds: string[] = [];
    let sigint: (() => void) | undefined;
    const promise = runWatchMode('/launch', WATCH_FLAGS, {
      isTTY: true,
      resolveWatchCwdFn: () => '/live',
      readHudConfigFn: async () => ({ preset: 'focused', git: { display: 'repo-branch' }, statusLine: { preset: 'focused' } }),
      readAllStateFn: async (cwd) => {
        seenCwds.push(cwd);
        return { ...emptyCtx(), gitBranch: 'main' };
      },
      renderHudFn: () => 'frame',
      writeStdout: (text) => { writes.push(text); },
      writeStderr: () => {},
      registerSigint: (handler) => { sigint = handler; },
      setIntervalFn: () => ({}) as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });
    await flush();
    sigint?.();
    await promise;
    assert.deepEqual(seenCwds, ['/live']);
    assert.ok(writes.join('').includes('frame'));
    assert.ok(writes.join('').includes('\x1b[?25h\x1b[2J\x1b[H'));
  });

  it('coalesces overlapping interval ticks', async () => {
    let sigint: (() => void) | undefined;
    let tick: (() => void) | undefined;
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const firstGate = deferred();
    const firstStarted = deferred();
    const secondStarted = deferred();
    const promise = runWatchMode('/tmp', WATCH_FLAGS, {
      isTTY: true,
      readHudConfigFn: async () => ({ preset: 'focused', git: { display: 'repo-branch' }, statusLine: { preset: 'focused' } }),
      readAllStateFn: async () => {
        calls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (calls === 1) {
          firstStarted.resolve();
          await firstGate.promise;
        } else {
          secondStarted.resolve();
        }
        inFlight -= 1;
        return emptyCtx();
      },
      renderHudFn: () => 'frame',
      writeStdout: () => {},
      writeStderr: () => {},
      registerSigint: (handler) => { sigint = handler; },
      setIntervalFn: (handler) => { tick = handler; return ({}) as ReturnType<typeof setInterval>; },
      clearIntervalFn: () => {},
    });
    await firstStarted.promise;
    tick?.();
    tick?.();
    firstGate.resolve();
    await secondStarted.promise;
    sigint?.();
    await promise;
    assert.equal(calls, 2);
    assert.equal(maxInFlight, 1);
  });

  it('restores terminal state after a render failure', async () => {
    const writes: string[] = [];
    const errors: string[] = [];
    await runWatchMode('/tmp', WATCH_FLAGS, {
      isTTY: true,
      readHudConfigFn: async () => ({ preset: 'focused', git: { display: 'repo-branch' }, statusLine: { preset: 'focused' } }),
      readAllStateFn: async () => { throw new Error('boom'); },
      writeStdout: (text) => { writes.push(text); },
      writeStderr: (text) => { errors.push(text); },
      registerSigint: () => {},
      setIntervalFn: () => ({}) as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });
    assert.equal(process.exitCode, 1);
    assert.ok(errors.some((line) => line.includes('HUD watch render failed: boom')));
    assert.ok(writes.join('').includes('\x1b[?25h\x1b[2J\x1b[H'));
  });
});
