import { describe, it } from 'node:test';
import {
  FRONTEND_PR_MEDIA_CONTRACTS,
  FRONTEND_VISUAL_EVIDENCE_CONTRACTS,
} from '../prompt-guidance-contract.js';
import { assertContractSurface } from './prompt-guidance-test-helpers.js';

describe('frontend visual evidence guidance', () => {
  for (const contract of FRONTEND_VISUAL_EVIDENCE_CONTRACTS) {
    it(`${contract.id} keeps screenshot and UX recording evidence mandatory`, () => {
      assertContractSurface(contract);
    });
  }
});

describe('frontend PR media guidance', () => {
  for (const contract of FRONTEND_PR_MEDIA_CONTRACTS) {
    it(`${contract.id} keeps published PR media mandatory`, () => {
      assertContractSurface(contract);
    });
  }
});
