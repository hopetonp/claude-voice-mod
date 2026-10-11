import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionTitle } from '../host/session-title.js'

test('a session is named by the newest title its transcript records', async () => {
  const projects = await mkdtemp(join(tmpdir(), 'titles-'))
  await mkdir(join(projects, '-Users-me-chopitup'))
  await writeFile(join(projects, '-Users-me-chopitup', 'abc-1.jsonl'), [
    '{"type":"user","message":"hi"}',
    '{"type":"custom-title","customTitle":"First name","sessionId":"abc-1"}',
    '{"type":"custom-title","customTitle":"Fix \\"login\\" flow","sessionId":"abc-1"}',
  ].join('\n'))
  assert.equal(await sessionTitle('abc-1', '/Users/me/chopitup', projects), 'Fix "login" flow')
  assert.equal(await sessionTitle('abc-1', '', projects), 'Fix "login" flow', 'found without its folder')
  assert.equal(await sessionTitle('missing', '/Users/me/chopitup', projects), '')
  assert.equal(await sessionTitle('../escape', '/Users/me/chopitup', projects), '')
})
