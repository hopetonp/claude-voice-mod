/** Isolated tool/result diagnostic. No Claude task is created. */
export const protocolCheckSession = {
  instructions: 'This is a protocol diagnostic. When asked, call dispatch_coding_task once. After acceptance say only "Task accepted". After receiving the later completion update say only "The test task completed". Do not call tools again.',
  tools: [{ type: 'function', name: 'dispatch_coding_task',
    description: 'Simulate accepting a coding task. This diagnostic never executes code.',
    parameters: { type: 'object', properties: { instruction: { type: 'string' } },
      required: ['instruction'], additionalProperties: false } }],
}

const textItem = text => ({ type: 'conversation.item.create', item: { type: 'message', role: 'user',
  content: [{ type: 'input_text', text }] } })

export class StsProtocolCheck {
  stage = 'call'
  audio = false

  start() {
    return [textItem('Call dispatch_coding_task to simulate checking a test repository.'), { type: 'response.create' }]
  }

  accept(event) {
    if (event.type === 'response.output_audio.delta') {
      if (typeof event.delta !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.delta)) return false
      const bytes = Buffer.from(event.delta, 'base64')
      if (!bytes.length || bytes.length % 2) return false
      this.audio = true
      return []
    }
    if (event.type !== 'response.done') return []
    const response = event.response
    if (!response || response.status !== 'completed' || !Array.isArray(response.output)) return false
    const calls = response.output.filter(item => item?.type === 'function_call')
    if (this.stage === 'call') {
      if (calls.length !== 1) return false
      const call = calls[0]
      if (call.name !== 'dispatch_coding_task' || typeof call.call_id !== 'string' || !call.call_id) return false
      let args
      try { args = JSON.parse(call.arguments) } catch { return false }
      if (!args || typeof args.instruction !== 'string' || !args.instruction.trim()
        || Object.keys(args).length !== 1) return false
      this.stage = 'acceptance'
      this.audio = false
      return [{ type: 'conversation.item.create', item: { type: 'function_call_output',
        call_id: call.call_id, output: JSON.stringify({ status: 'accepted', request: 'diagnostic-task' }) } },
      { type: 'response.create' }]
    }
    if (calls.length || !this.audio) return false
    if (this.stage === 'completion') return true
    this.stage = 'completion'
    this.audio = false
    return [textItem('Coding task update: diagnostic-task completed successfully. This is a simulated result, not a new task. Announce completion.'),
      { type: 'response.create' }]
  }
}
