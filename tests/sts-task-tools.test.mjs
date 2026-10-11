import test from 'node:test'
import assert from 'node:assert/strict'
import { codingCalls, codingTools, runCodingCall } from '../host/sts-task-tools.js'
import { preferredTranscriptionModel } from '../host/realtime-voice.js'
import { openaiStsProvider, xaiStsProvider, geminiStsProvider } from '@voicemesh/composer/server'

test('Composer tool call admits only one complete coding request to the linked task ledger', async () => {
  const handled = new Set()
  const response = { status: 'completed', output: [
    { type: 'function_call', call_id: 'call-1', name: 'dispatch_coding_task', arguments: '{"instruction":" Inspect the README "}' },
    { type: 'message', content: 'Checking.' },
  ] }
  const calls = codingCalls(response, handled)
  assert.equal(calls.length, 1)
  assert.deepEqual(codingCalls(response, handled), [])
  assert.ok(codingTools.some(tool => tool.name === calls[0].name))
  const admitted = []
  const tasks = { states: () => [], async dispatch(id, args) { admitted.push({ id, args }); return { requestId: 'scoped-id' } } }
  assert.deepEqual(await runCodingCall(calls[0], tasks), { status: 'queued', requestId: 'scoped-id' })
  assert.deepEqual(admitted, [{ id: 'call-1', args: { instruction: 'Inspect the README' } }])
  assert.deepEqual(await runCodingCall({ ...calls[0], arguments: '{"instruction":""}' }, tasks),
    { status: 'not-confirmed', tasks: [], message: 'Invalid coding request' })
  assert.equal(admitted.length, 1)
})

test('status reads recorded state and an ambiguous dispatch failure stays unconfirmed', async () => {
  const tasks = { states: () => [{ requestId: 'earlier', status: 'running' }],
    async dispatch() { throw new Error('Persistence uncertain') } }
  const status = { type: 'function_call', call_id: 'status-1', name: 'get_coding_task_status', arguments: '{}' }
  assert.deepEqual(await runCodingCall(status, tasks), { tasks: [{ requestId: 'earlier', status: 'running' }] })
  const call = { ...status, name: 'dispatch_coding_task', arguments: '{"instruction":"Inspect the code"}' }
  assert.deepEqual(await runCodingCall(call, tasks), {
    status: 'not-confirmed', tasks: [{ requestId: 'earlier', status: 'running' }], message: 'Persistence uncertain',
  })
})

test('readback returns saved output without dispatching another coding request', async () => {
  let dispatched = false
  const tasks = { states: () => [], lastOutput: () => ({ status: 'complete', text: 'Claude found the title.' }),
    async dispatch() { dispatched = true } }
  const call = { type: 'function_call', call_id: 'read-1', name: 'get_last_output', arguments: '{}' }
  assert.deepEqual(await runCodingCall(call, tasks), { status: 'complete', text: 'Claude found the title.' })
  assert.equal(dispatched, false)
})

test('Composer receives the coding tool for each non-Live realtime provider', () => {
  const settings = { key: 'test-key', model: 'test-model', voice: 'test-voice',
    transcriptionModel: 'gpt-4o-mini-transcribe', instructions: 'Delegate coding work.',
    tools: codingTools, silenceSec: 1, thinking: false }
  for (const provider of [openaiStsProvider, xaiStsProvider, geminiStsProvider]) {
    const setup = provider.create(settings).setup
    assert.match(JSON.stringify(setup), /dispatch_coding_task/)
  }
  assert.equal(preferredTranscriptionModel(['whisper-1', 'gpt-4o-mini-transcribe']), 'gpt-4o-mini-transcribe')
})

test('a coding request while Claude is working steers the running task instead of dispatching', async () => {
  const steered = []
  let dispatched = false
  const tasks = { states: () => [{ requestId: 'earlier', status: 'running' }],
    async steer(id, args) { steered.push({ id, args }); return [] },
    async dispatch() { dispatched = true } }
  const call = { type: 'function_call', call_id: 'call-stop', name: 'dispatch_coding_task', arguments: '{"instruction":"stop"}' }
  const result = await runCodingCall(call, tasks)
  assert.deepEqual(steered, [{ id: 'call-stop', args: { instruction: 'stop' } }])
  assert.equal(dispatched, false)
  assert.equal(result.status, 'steered')
})

test("a coding call carries the user's own words when there is a transcript", async () => {
  const { runCodingCall } = await import('../host/sts-task-tools.js')
  const dispatched = []
  const tasks = { states: () => [], async dispatch(_id, args) { dispatched.push(args.instruction); return { requestId: 'r1' } } }
  const call = { call_id: 'c1', name: 'dispatch_coding_task', arguments: JSON.stringify({ instruction: 'User reports that the bubble splits.' }) }
  await runCodingCall(call, tasks, undefined, '  Why does the bubble split into pieces?  ')
  await runCodingCall({ ...call, call_id: 'c2' }, tasks, undefined, '')
  assert.deepEqual(dispatched, ['Why does the bubble split into pieces?', 'User reports that the bubble splits.'])
})
