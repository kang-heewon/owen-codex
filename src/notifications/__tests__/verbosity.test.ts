import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getVerbosity,
  isEventAllowedByVerbosity,
  isEventEnabled,
} from '../config.js';
import type { FullNotificationConfig, VerbosityLevel } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<FullNotificationConfig> = {}): FullNotificationConfig {
  return {
    enabled: true,
    discord: { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/test' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getVerbosity
// ---------------------------------------------------------------------------

describe('getVerbosity', () => {
  const origEnv = process.env.OWX_NOTIFY_VERBOSITY;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.OWX_NOTIFY_VERBOSITY;
    } else {
      process.env.OWX_NOTIFY_VERBOSITY = origEnv;
    }
  });

  it('defaults to "session" when no config or env var', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    assert.equal(getVerbosity(makeConfig()), 'session');
  });

  it('reads verbosity from config', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    assert.equal(getVerbosity(makeConfig({ verbosity: 'minimal' })), 'minimal');
  });

  it('env var overrides config', () => {
    process.env.OWX_NOTIFY_VERBOSITY = 'verbose';
    assert.equal(getVerbosity(makeConfig({ verbosity: 'minimal' })), 'verbose');
  });

  it('ignores invalid env var and falls back to config', () => {
    process.env.OWX_NOTIFY_VERBOSITY = 'invalid';
    assert.equal(getVerbosity(makeConfig({ verbosity: 'agent' })), 'agent');
  });

  it('ignores invalid config value and falls back to default', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    assert.equal(getVerbosity(makeConfig({ verbosity: 'bogus' as VerbosityLevel })), 'session');
  });

  it('handles null config gracefully', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    assert.equal(getVerbosity(null), 'session');
  });
});

// ---------------------------------------------------------------------------
// isEventAllowedByVerbosity
// ---------------------------------------------------------------------------

describe('isEventAllowedByVerbosity', () => {
  // Minimal: start, stop, end only
  it('minimal allows session-start', () => {
    assert.equal(isEventAllowedByVerbosity('minimal', 'session-start'), true);
  });
  it('minimal allows session-stop', () => {
    assert.equal(isEventAllowedByVerbosity('minimal', 'session-stop'), true);
  });
  it('minimal allows session-end', () => {
    assert.equal(isEventAllowedByVerbosity('minimal', 'session-end'), true);
  });
  it('minimal rejects session-idle', () => {
    assert.equal(isEventAllowedByVerbosity('minimal', 'session-idle'), false);
  });
  it('minimal rejects ask-user-question', () => {
    assert.equal(isEventAllowedByVerbosity('minimal', 'ask-user-question'), false);
  });

  // Session: includes idle
  it('session allows session-idle', () => {
    assert.equal(isEventAllowedByVerbosity('session', 'session-idle'), true);
  });
  it('session rejects ask-user-question', () => {
    assert.equal(isEventAllowedByVerbosity('session', 'ask-user-question'), false);
  });

  // Agent: includes ask-user-question
  it('agent allows ask-user-question', () => {
    assert.equal(isEventAllowedByVerbosity('agent', 'ask-user-question'), true);
  });
  it('agent allows session-idle', () => {
    assert.equal(isEventAllowedByVerbosity('agent', 'session-idle'), true);
  });

  // Verbose: allows everything
  it('verbose allows all events', () => {
    assert.equal(isEventAllowedByVerbosity('verbose', 'session-start'), true);
    assert.equal(isEventAllowedByVerbosity('verbose', 'session-stop'), true);
    assert.equal(isEventAllowedByVerbosity('verbose', 'session-end'), true);
    assert.equal(isEventAllowedByVerbosity('verbose', 'session-idle'), true);
    assert.equal(isEventAllowedByVerbosity('verbose', 'ask-user-question'), true);
  });
});

// ---------------------------------------------------------------------------
// isEventEnabled with verbosity
// ---------------------------------------------------------------------------

describe('isEventEnabled with verbosity', () => {
  const origEnv = process.env.OWX_NOTIFY_VERBOSITY;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.OWX_NOTIFY_VERBOSITY;
    } else {
      process.env.OWX_NOTIFY_VERBOSITY = origEnv;
    }
  });

  it('minimal config blocks session-idle', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const config = makeConfig({ verbosity: 'minimal' });
    assert.equal(isEventEnabled(config, 'session-idle'), false);
  });

  it('minimal config allows session-end', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const config = makeConfig({ verbosity: 'minimal' });
    assert.equal(isEventEnabled(config, 'session-end'), true);
  });

  it('session config allows session-idle', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const config = makeConfig({ verbosity: 'session' });
    assert.equal(isEventEnabled(config, 'session-idle'), true);
  });

  it('session config blocks ask-user-question', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const config = makeConfig({ verbosity: 'session' });
    assert.equal(isEventEnabled(config, 'ask-user-question'), false);
  });

  it('env var override takes precedence', () => {
    process.env.OWX_NOTIFY_VERBOSITY = 'verbose';
    const config = makeConfig({ verbosity: 'minimal' });
    assert.equal(isEventEnabled(config, 'ask-user-question'), true);
  });

  it('openclaw-only config passes the platform gate', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const config: FullNotificationConfig = {
      enabled: true,
      openclaw: { enabled: true },
    };
    assert.equal(isEventEnabled(config, 'session-start'), true);
  });

  it('openclaw-only config returns true when event has no per-event override', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const config: FullNotificationConfig = {
      enabled: true,
      openclaw: { enabled: true },
    };
    assert.equal(isEventEnabled(config, 'session-end'), true);
  });

  it('openclaw-only config returns false when globally disabled', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const config: FullNotificationConfig = {
      enabled: false,
      openclaw: { enabled: true },
    };
    assert.equal(isEventEnabled(config, 'session-start'), false);
  });

  it('openclaw-only config falls through to top-level check when event config exists without platform overrides', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const config: FullNotificationConfig = {
      enabled: true,
      openclaw: { enabled: true },
      events: {
        'session-start': { enabled: true },
      },
    };
    assert.equal(isEventEnabled(config, 'session-start'), true);
  });

  it('uses notifications.events for event gating rather than telegram.events', () => {
    delete process.env.OWX_NOTIFY_VERBOSITY;
    const misplacedTelegramEvents = makeConfig({
      telegram: {
        enabled: true,
        botToken: '123:abc',
        chatId: '456',
        events: {
          'session-start': { enabled: false },
        },
      } as FullNotificationConfig['telegram'] & {
        events: Record<string, { enabled: boolean }>;
      },
    });
    assert.equal(isEventEnabled(misplacedTelegramEvents, 'session-start'), true);

    const topLevelEvents = makeConfig({
      events: {
        'session-start': { enabled: false },
      },
    });
    assert.equal(isEventEnabled(topLevelEvents, 'session-start'), false);
  });
});

// ---------------------------------------------------------------------------
