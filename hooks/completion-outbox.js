const valid = item => item && typeof item.id === 'string' && typeof item.sessionId === 'string'
  && typeof item.turnId === 'string' && ['complete', 'aborted', 'failed'].includes(item.status)
  && typeof item.text === 'string'

/** Persist completion before reporting it; failed/lost acknowledgements are retried. */
export function createCompletionOutbox({ load, save, deliver }) {
  const pending = new Map()
  let loaded = false
  let flushing = null
  const key = item => `${item.sessionId}:${item.id}:${item.turnId}`
  const ensureLoaded = async () => {
    if (loaded) return
    const stored = await load()
    for (const item of Array.isArray(stored) ? stored : []) if (valid(item) && !pending.has(key(item))) pending.set(key(item), item)
    loaded = true
  }
  const flush = async () => {
    if (flushing) return flushing
    flushing = (async () => {
      await ensureLoaded()
      for (const [id, item] of [...pending]) {
        await save([...pending.values()])
        try { await deliver(item) } catch { continue }
        if (pending.get(id) === item) pending.delete(id)
        await save([...pending.values()])
      }
    })()
    try { await flushing } finally { flushing = null }
  }
  return {
    async queue(item) {
      if (!valid(item)) throw new Error('Invalid Claude completion')
      await ensureLoaded()
      pending.set(key(item), { ...item, text: item.text.slice(0, 16000) })
      await save([...pending.values()])
      await flush()
    },
    flush,
  }
}
