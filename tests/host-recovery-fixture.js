export function finishedTranscript(task) {
  return [
    { type: 'user', uuid: 'request-root', promptId: 'cli-prompt', sessionId: task.sessionId,
      timestamp: new Date(task.claimedAt + 10).toISOString(), origin: { kind: 'plugin', name: 'voicemesh-controls', asUser: true },
      message: { content: task.text } },
    { type: 'assistant', uuid: 'answer', parentUuid: 'request-root', sessionId: task.sessionId,
      message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Recovered answer.' }] } },
    { type: 'system', parentUuid: 'answer', sessionId: task.sessionId, subtype: 'stop_hook_summary',
      preventedContinuation: false, hookErrors: [] },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
}
