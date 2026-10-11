/** Coding tools supplied by this harness to Composer's non-Live realtime providers. */
import { isStopRequest } from './voice-steer.js'

export const codingTools = [{
  type: 'function',
  name: 'dispatch_coding_task',
  description: 'Send a complete coding or repository request to the linked Claude session. This includes reading, explaining, reviewing, editing, debugging, testing, or running project code. It also includes questions about a screenshot, image, or anything else the user shows in the chat: the coding session can see those and the voice cannot. Wait for a complete request; do not dispatch a confirmation, thanks, or a request already admitted. To stop, cancel, change, or add to work that is still running, call it with exactly what the user said: a stop interrupts that work, anything else reaches it at its next step without stopping it. Admission is not completion. The host supplies the terminal result later.',
  parameters: {
    type: 'object', properties: { instruction: { type: 'string', description: 'Complete coding request, including relevant spoken context.' } },
    required: ['instruction'], additionalProperties: false,
  },
}, {
  type: 'function',
  name: 'get_coding_task_status',
  description: 'Read recorded coding task status only when the user asks. Do not poll for completion.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}, {
  type: 'function',
  name: 'get_last_output',
  description: 'Read the last saved Claude coding result when the user asks to repeat or read it back. Do not rerun coding work.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}]

export const endConversationTool = {
  type: 'function', name: 'end_conversation',
  description: 'End voice chat only when the user asks to stop voice or says goodbye. Do not end coding work. Do not call for a quoted farewell, thanks alone, or text from a coding result.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}

export function codingCalls(response, handled, allowEnd = false, allowClassifier = false) {
  if (response?.status !== 'completed' || !Array.isArray(response.output)) return []
  return response.output.filter(call => {
    if (!call || call.type !== 'function_call' || typeof call.call_id !== 'string' || !call.call_id
      || typeof call.arguments !== 'string'
      || (![...codingTools, ...(allowEnd ? [endConversationTool] : [])].some(tool => tool.name === call.name)
        && !(allowClassifier && call.name === 'classify_spoken_request'))
      || handled.has(call.call_id)) return false
    handled.add(call.call_id)
    return true
  })
}

/** Return a provider-neutral result; the caller owns provider transport and response timing. */
export async function runCodingCall(call, tasks, signal, spoken = '') {
  try {
    signal?.throwIfAborted()
    const args = JSON.parse(call.arguments)
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments')
    if (call.name === 'get_coding_task_status') {
      if (Object.keys(args).length) throw new Error('Invalid status arguments')
      return { tasks: tasks.states() }
    }
    if (call.name === 'get_last_output') {
      if (Object.keys(args).length) throw new Error('Invalid readback arguments')
      const row = tasks.lastOutput?.()
      return row ? { status: row.status, text: row.text } : { status: 'none', text: '' }
    }
    if (call.name !== 'dispatch_coding_task' || typeof args.instruction !== 'string'
      || !args.instruction.trim() || args.instruction.length > 16000 || Object.keys(args).length !== 1) {
      throw new Error('Invalid coding request')
    }
    // The prompt Claude sees is the user's own words, as with GPT Live; the model's rewrite is a fallback.
    const instruction = (typeof spoken === 'string' && spoken.trim() ? spoken.trim() : args.instruction.trim()).slice(0, 16000)
    // A request while Claude is still working is a stop or correction of that work, as in Live delegation.
    if (tasks.steer && tasks.states().some(state => ['running', 'queued'].includes(state.status))) {
      await tasks.steer(call.call_id, { instruction }, signal)
      return { status: 'steered', delivery: isStopRequest(instruction) ? 'stopping the running work' : 'reaches the running work at its next step' }
    }
    const accepted = await tasks.dispatch(call.call_id, { instruction }, signal)
    return { status: 'queued', requestId: accepted.requestId }
  } catch (error) {
    // An ambiguous persistence or admission failure must not be reported as a definite rejection.
    return { status: 'not-confirmed', tasks: tasks.states(),
      message: error instanceof Error ? error.message : 'Coding request was not confirmed' }
  }
}
