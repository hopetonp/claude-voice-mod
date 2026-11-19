import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('macOS uninstall removes caches, preserves data by default, and purges only VoiceMesh records', { skip: process.platform !== 'darwin' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'voicemesh-uninstall-'))
  const user = join(root, 'VoiceMeshPackageSmoke/user')
  const caches = ['Library/Application Support/VoiceMesh/ClaudeVoice/app.txt', 'Library/Application Support/VoiceMesh/Marketplaces/old.zip',
    'Library/Caches/com.voicemesh.claude.settings/WebKit/cache', 'Library/WebKit/com.voicemesh.claude.settings/data']
  const personal = ['.claude/voicemesh-controls/providers.json', '.claude/plugins/data/voicemesh-controls-inline/history',
    '.claude/plugins/cache/voicemesh-local/plugin.json', '.claude/plugins/store/voicemesh-controls_voicemesh-local-test.json']
  const other = '.claude/plugins/store/other-plugin.json'
  try {
    for (const path of [...caches, ...personal, other]) {
      await mkdir(resolve(user, path, '..'), { recursive: true })
      await writeFile(join(user, path), 'test data')
    }
    const run = args => execFileSync('/bin/sh', [resolve('macos/uninstall.sh'), '--staging-only', ...args], { env: { ...process.env, TMPDIR: root }, encoding: 'utf8' })
    assert.match(run([]), /Saved settings, credentials and history remain/)
    for (const path of caches) await assert.rejects(access(join(user, path)))
    for (const path of personal) await access(join(user, path))
    assert.match(run(['--purge']), /including saved settings/)
    for (const path of personal) await assert.rejects(access(join(user, path)))
    await access(join(user, other))
  } finally { await rm(root, { recursive: true, force: true }) }
})
