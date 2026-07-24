import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNativeRolePlan, listNativeAgentTypes } from '../native-role-plan.js';

describe('native role plan', () => {
  it('lists only catalog-installable native agent types by default', () => {
    const available = listNativeAgentTypes();
    assert.ok(available.includes('executor'));
    assert.ok(available.includes('code-simplifier'));
    assert.equal(available.includes('qa-tester'), false);
    assert.equal(available.includes('product-manager'), false);
  });

  it('recommends installed agent types without execution-runtime fields', () => {
    const plan = buildNativeRolePlan('debug a flaky regression', [
      'architect',
      'debugger',
      'executor',
      'test-engineer',
    ]);

    assert.deepEqual(plan.recommendedAgentTypes, ['debugger', 'test-engineer', 'architect']);
    assert.deepEqual(Object.keys(plan).sort(), [
      'availableAgentTypes',
      'recommendedAgentTypes',
      'summary',
    ]);
    assert.match(plan.summary, /native agent_type directly/);
  });

  it('falls back to leader execution when no native role is available', () => {
    const plan = buildNativeRolePlan('implement the change', []);
    assert.deepEqual(plan.recommendedAgentTypes, []);
    assert.match(plan.summary, /Continue in the leader/);
  });
});
