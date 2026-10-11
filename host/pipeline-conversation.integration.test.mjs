import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

test('Claude host catalogs and streams a custom Composer conversation', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-voice-pipeline-'))
  const seen = []
  const upstream = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'local-test-model' }] }))
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    seen.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) })
    response.setHeader('Content-Type', 'text/event-stream')
    response.end('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n')
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const portServer = createServer()
  portServer.listen(0, '127.0.0.1')
  await once(portServer, 'listening')
  const hostPort = portServer.address().port
  await new Promise(resolve => portServer.close(resolve))
  const settingsFile = join(root, 'providers.json')
  const connectionFile = join(root, 'connection.json')
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`
  await writeFile(settingsFile, JSON.stringify({ voiceMode: 'pipeline', pipeline: {
    conversationalProvider: 'custom', conversationalBaseUrl: baseUrl, conversationalModel: 'local-test-model',
  } }))
  const child = spawn(process.execPath, ['host/server.js'], { cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, VOICE_HOST_PORT: String(hostPort), VOICEMESH_CONNECTION_FILE: connectionFile,
      COMPOSER_SETTINGS_FILE: settingsFile, VOICEMESH_TASK_FILE: join(root, 'task.json'),
      VOICEMESH_RESULT_FILE: join(root, 'result.json'), VOICEMESH_TRANSCRIPT_FILE: join(root, 'transcripts.json'),
      VOICE_MEDIA_BROWSER: '/usr/bin/true', VOICE_MEDIA_PROFILE: join(root, 'media') }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  try {
    let connection
    for (let i = 0; i < 100; i++) {
      try { connection = JSON.parse(await readFile(connectionFile, 'utf8')); break }
      catch { await new Promise(resolve => setTimeout(resolve, 50)) }
    }
    assert.ok(connection, `host did not start: ${stderr}`)
    const headers = { Authorization: `Bearer ${connection.token}` }
    const providers = await fetch(`${connection.url}/api/pipeline/options?kind=conversation-provider`, { headers }).then(r => r.json())
    assert.ok(providers.options.some(item => item.id === 'custom'))
    assert.ok(providers.options.some(item => item.id === 'deepseek'))
    const models = await fetch(`${connection.url}/api/pipeline/options?kind=conversation-model&engine=custom`, { headers }).then(r => r.json())
    assert.deepEqual(models.options, [{ id: 'local-test-model', label: 'local-test-model' }])
    const savedKey = await fetch(`${connection.url}/api/pipeline/key`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'custom', baseUrl, key: 'isolated-test-key' }) })
    assert.equal(savedKey.status, 200)
    const keyStatus = await fetch(`${connection.url}/api/pipeline/key-status?provider=custom&baseUrl=${encodeURIComponent(baseUrl)}`,
      { headers }).then(r => r.json())
    assert.equal(keyStatus.configured, true)
    const answer = await fetch(`${connection.url}/api/pipeline/answer`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({
        messages: [{ role: 'user', content: 'Write code' }],
        tools: [{ type: 'function', function: { name: 'dispatch_coding_task', description: 'Code', parameters: {} } }],
      }) })
    assert.equal(answer.status, 200)
    assert.match(await answer.text(), /OK/)
    assert.equal(seen[0].url, '/v1/chat/completions')
    assert.equal(seen[0].body.model, 'local-test-model')
    assert.equal(seen[0].authorization, 'Bearer isolated-test-key')
    assert.equal(seen[0].body.tools[0].function.name, 'dispatch_coding_task')
    const probe = await fetch(`${connection.url}/api/pipeline/conversation-test`, { method: 'POST', headers })
    assert.deepEqual(await probe.json(), { ready: true })
    const classifierKey = await fetch(`${connection.url}/api/classifier/key`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'jev', key: 'isolated-jev-key' }) })
    assert.equal(classifierKey.status, 200)
    const classifierSettings = await fetch(`${connection.url}/api/classifier/settings`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'jev', model: 'jev-latest', enabled: true }) })
    assert.equal(classifierSettings.status, 200)
    assert.deepEqual((await classifierSettings.json()).classifier, {
      provider: 'jev', model: 'jev-latest', enabled: true,
    })
    const status = await fetch(`${connection.url}/api/classifier/key-status?provider=jev`, { headers }).then(r => r.json())
    assert.deepEqual(status, { configured: true })
  } finally {
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))])
    await new Promise(resolve => upstream.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
