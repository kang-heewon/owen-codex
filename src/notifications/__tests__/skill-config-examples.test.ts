import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';

for (const transport of ['webhook', 'cli']) {
  it(`documented ${transport} configuration preserves input and rejects invalid events`, async () => {
    const skill = await readFile('skills/configure-notifications/SKILL.md', 'utf8');
    const heading = transport === 'webhook' ? '### 4a)' : '### 4b)';
    const section = skill.slice(skill.indexOf(heading));
    const script = section.match(/```bash\n([\s\S]*?)```/)?.[1];
    assert.ok(script);
    const dir = await mkdtemp(join(tmpdir(), 'owx-notification-example-'));
    const config = join(dir, 'config.json');
    const original = { unrelated: { preserved: true } };
    const events = ['session-start', 'stop'];
    const headers = { Authorization: 'Bearer fixture-only', 'X-Test': 'a b' };
    const env = {
      ...process.env, CONFIG_FILE: config, URL: 'https://example.test/hooks',
      METHOD: 'PUT', COMMAND_TEMPLATE: 'echo {{event}}',
      INSTRUCTION: 'event {{event}}', HEADERS_JSON: JSON.stringify(headers),
      EVENTS_JSON: JSON.stringify(events),
    };
    try {
      await writeFile(config, JSON.stringify(original));
      const result = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const saved = JSON.parse(await readFile(config, 'utf8'));
      assert.deepEqual(saved.unrelated, original.unrelated);
      const alias = saved.notifications[`custom_${transport}_command`];
      assert.deepEqual(alias.events, events);
      assert.equal(alias.instruction, env.INSTRUCTION);
      if (transport === 'webhook') {
        assert.deepEqual(alias.headers, headers);
        assert.equal(alias.method, 'PUT');
      } else {
        assert.equal(alias.command, env.COMMAND_TEMPLATE);
      }
      for (const invalid of [ { EVENTS_JSON: '["bogus"]' }, { EVENTS_JSON: '[]' },
        ...(transport === 'webhook' ? [{ HEADERS_JSON: '{"Authorization":12}' }, { METHOD: 'DELETE' }] : []) ]) {
        const before = await readFile(config, 'utf8');
        const rejected = spawnSync('bash', ['-c', script], { env: { ...env, ...invalid }, encoding: 'utf8' });
        assert.notEqual(rejected.status, 0);
        assert.equal(await readFile(config, 'utf8'), before);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
