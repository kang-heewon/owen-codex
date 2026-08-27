import { describe, it } from 'node:test';
import { FRONTEND_VISUAL_EVIDENCE_CONTRACTS } from '../prompt-guidance-contract.js';
import { assertContractSurface } from './prompt-guidance-test-helpers.js';

describe('frontend visual evidence guidance', () => {
  for (const contract of FRONTEND_VISUAL_EVIDENCE_CONTRACTS) {
    it(`${contract.id} keeps browser measurement and screenshot evidence mandatory`, () => {
      assertContractSurface(contract);
    });
  }
});
