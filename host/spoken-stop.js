import { isDirectStopRequest } from './voice-steer.js'

/** Route clear live spoken stops without waiting for conversation-close transcript finalization. */
export function createSpokenStopRouter(tasks, onRequested = () => {}, { quietMs = 350, onError = console.error } = {}) {
  let lastRequest = null
  let pending = null
  let captionTimer = null
  let closed = false
  const clearCaption = () => {
    if (captionTimer) clearTimeout(captionTimer.timer)
    captionTimer = null
  }
  const requestStop = async (id, input, signal, expectedRequestId) => {
    if (!isDirectStopRequest(input?.instruction ?? '')) return null
    const current = tasks.states()[0]
    if (!current?.requestId || (expectedRequestId && current.requestId !== expectedRequestId)) return null
    if (current.requestId === lastRequest) return current.requestId
    if (!['running', 'queued'].includes(current.status)) return null
    if (pending?.id === current.requestId) return pending.promise
    const requestId = current.requestId
    const promise = (async () => {
      await tasks.steer(id, { ...input, expectedRequestId: requestId }, signal)
      lastRequest = requestId
      onRequested(requestId)
      return requestId
    })()
    pending = { id: requestId, promise }
    try { return await promise } finally { if (pending?.promise === promise) pending = null }
  }
  return {
    close() { closed = true; clearCaption() },
    async caption(caption) {
      if (closed || caption.role !== 'user' || typeof caption.id !== 'string' || !caption.id) return
      const current = tasks.states()[0]
      // LiveDelegation returns live rows without a phase; its "final" arrives
      // only from close(). Briefly wait for live text to stop changing instead.
      if (!isDirectStopRequest(caption.text ?? '')) {
        if (captionTimer?.id === caption.id) clearCaption()
        return
      }
      if (caption.phase === 'final' || caption.final === true) {
        clearCaption()
        await requestStop(`caption-stop:${caption.id}`, { instruction: caption.text })
        return
      }
      if (!current || !['running', 'queued'].includes(current.status)) return
      if (captionTimer?.id === caption.id && captionTimer.text === caption.text) return
      clearCaption()
      const saved = { id: caption.id, text: caption.text, requestId: current.requestId }
      saved.timer = setTimeout(() => {
        captionTimer = null
        void requestStop(`caption-stop:${saved.id}`, { instruction: saved.text }, undefined, saved.requestId).catch(onError)
      }, quietMs)
      captionTimer = saved
    },
    tasks: {
      ...tasks,
      async dispatch(id, input, signal) {
        const requestId = await requestStop(id, input, signal)
        return requestId ? { requestId } : tasks.dispatch(id, input, signal)
      },
      async steer(id, input, signal) {
        const requestId = await requestStop(id, input, signal)
        return requestId ? tasks.states() : tasks.steer(id, input, signal)
      },
    },
  }
}
