import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PROMPT_REFACTOR_INVARIANT_CONTRACTS,
  PROMPT_REFACTOR_MARKER_CONTRACTS,
} from '../prompt-guidance-contract.js';
import { assertContractSurface, loadSurface } from './prompt-guidance-test-helpers.js';

describe('prompt refactor contract locks', () => {
  const retainedInvariantContracts = PROMPT_REFACTOR_INVARIANT_CONTRACTS.filter(
    ({ id }) => id !== 'deep-interview-question-gate' && id !== 'cancel-safety-boundary',
  );

  for (const contract of retainedInvariantContracts) {
    it(`${contract.id} keeps its semantic invariant language`, () => {
      assertContractSurface(contract);
    });
  }

  for (const contract of PROMPT_REFACTOR_MARKER_CONTRACTS) {
    it(`${contract.id} keeps required marker literals byte-identical`, () => {
      for (const path of contract.requiredPaths) {
        const content = loadSurface(path);
        for (const marker of contract.markers) {
          assert.ok(content.includes(marker), `${path} missing marker ${marker}`);
        }
      }
    });
  }
});
