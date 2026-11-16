/** A missed local-host poll must not overwrite the provider/audio lifecycle. */
export function createHostPoll(poll, { unavailable, recovered, now = Date.now } = {}) {
  let running = false
  let failures = 0
  let retryAt = 0
  return async () => {
    if (running || now() < retryAt) return
    running = true
    try {
      await poll()
      const wasUnavailable = failures >= 3
      failures = 0
      retryAt = 0
      if (wasUnavailable) recovered?.()
    } catch (error) {
      failures++
      retryAt = now() + Math.min(400 * 2 ** Math.min(failures - 1, 4), 5000)
      if (failures === 1) console.warn('VoiceMesh host poll failed; retrying:', error.message)
      if (failures === 3) unavailable?.()
    } finally { running = false }
  }
}
