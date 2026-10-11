import assert from 'node:assert/strict'
import test from 'node:test'
import { CLAIM_START_TIMEOUT_MS, unstartedClaimExpired } from '../host/claim-recovery.js'

test('only an unstarted claimed request expires', () => {
  const now = 1_000_000
  const claimedAt = now - CLAIM_START_TIMEOUT_MS
  assert.equal(unstartedClaimExpired({ status: 'claimed', turnId: null, claimedAt }, now), true)
  assert.equal(unstartedClaimExpired({ status: 'claimed', turnId: null, claimedAt: claimedAt + 1 }, now), false)
  assert.equal(unstartedClaimExpired({ status: 'running', turnId: 'turn-1', claimedAt }, now), false)
  assert.equal(unstartedClaimExpired({ status: 'claimed', turnId: 'turn-1', claimedAt }, now), false)
})
