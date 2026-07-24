import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const originalFetch = globalThis.fetch;
const originalCodexHome = process.env.CODEX_HOME;

describe('notifyLifecycle OpenClaw dispatch', () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'owx-notify-index-codex-home-'));
  process.env.CODEX_HOME = codexHome;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  after(() => {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    rmSync(codexHome, { recursive: true, force: true });
  });

  it('awaits ask-user-question OpenClaw dispatch so reply routing stays on the live launch path', async () => {
    let openClawCalls = 0;
    let openClawResolved = false;

    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? String(input) : input.url;
      if (!url.includes('127.0.0.1:18789')) {
        return new Response('', { status: 200 });
      }
      openClawCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      openClawResolved = true;
      return new Response('', { status: 200 });
    };

    writeFileSync(join(codexHome, '.owx-config.json'), JSON.stringify({
      notifications: {
        enabled: true,
        verbosity: 'verbose',
        webhook: {
          enabled: true,
          url: 'https://example.com/hook',
        },
        events: {
          'ask-user-question': { enabled: true },
          'session-start': { enabled: true },
        },
        openclaw: {
          enabled: true,
          gateways: {
            local: { type: 'http', url: 'http://127.0.0.1:18789/hooks/agent' },
          },
          hooks: {
            'ask-user-question': {
              enabled: true,
              gateway: 'local',
              instruction: 'ask {{question}}',
            },
            'session-start': {
              enabled: true,
              gateway: 'local',
              instruction: 'start {{sessionId}}',
            },
          },
        },
      },
    }, null, 2));

    process.env.OWX_OPENCLAW = '1';
    const { resetOpenClawConfigCache } = await import('../../openclaw/config.js');
    resetOpenClawConfigCache();

    const projectPath = mkdtempSync(join(tmpdir(), 'owx-notify-index-project-ask-'));
    const { notifyLifecycle } = await import(`../index.js?ask-user-question-await=${Date.now()}`);

    const askStarted = Date.now();
    const askResult = await notifyLifecycle('ask-user-question', {
      sessionId: `sess-ask-${Date.now()}`,
      projectPath,
      question: 'Need approval?',
    });
    const askElapsed = Date.now() - askStarted;

    assert.ok(askResult);
    assert.equal(askResult.anySuccess, true);
    assert.equal(openClawCalls, 1);
    assert.equal(openClawResolved, true);
    assert.ok(askElapsed >= 50, `ask-user-question should await OpenClaw dispatch, got ${askElapsed}ms`);

    openClawCalls = 0;
    openClawResolved = false;
    const startResult = await notifyLifecycle('session-start', {
      sessionId: `sess-start-${Date.now()}`,
      projectPath,
    });

    assert.ok(startResult);
    assert.equal(startResult.anySuccess, true);
    assert.equal(openClawCalls, 1);
    assert.equal(openClawResolved, false, 'session-start should keep fire-and-forget OpenClaw dispatch');

    rmSync(projectPath, { recursive: true, force: true });
    delete process.env.OWX_OPENCLAW;
  });

});
