export const pausedSubmissionNotice = 'Claude has not started this request because its session is paused after a stop. The request is saved. The user needs to click Resume Claude once to start it; they do not need to repeat the request.'
const rejectedNotice = 'Claude did not accept this request, so work has not started. The request is saved for the user to retry using Resume Claude.'

/** Preserve the request and tell the listener why work did not start. */
export async function recordSubmissionRejection(task, reason, { persist, notify, now = Date.now }) {
  const rejection = { reason: typeof reason === 'string' ? reason.slice(0, 500) : 'No reason supplied', at: now() }
  await persist({ ...task, status: 'claimed', submissionState: 'rejected', submissionRejection: rejection })
  // Repeated reports for this same refusal must not produce repeated spoken notices.
  if (task.submissionRejection?.reason !== rejection.reason) {
    const stopped = rejection.reason.includes('session was stopped') && rejection.reason.includes('input since')
    await Promise.resolve().then(() => notify(stopped ? pausedSubmissionNotice : rejectedNotice)).catch(() => {})
  }
  return rejection
}
