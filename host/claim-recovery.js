// A claimed request has not started a Claude turn yet. If that transition never
// arrives, release the session without replaying a possibly submitted prompt.
export const CLAIM_START_TIMEOUT_MS = 60 * 1000

export function unstartedClaimExpired(task, now = Date.now()) {
  return ['claimed', 'submitting'].includes(task?.status) && !task.turnId
    && Number.isSafeInteger(task.claimedAt)
    && now - task.claimedAt >= CLAIM_START_TIMEOUT_MS
}
