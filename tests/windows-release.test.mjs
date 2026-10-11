import assert from 'node:assert/strict'
import test from 'node:test'
import { basename } from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseReleaseArgs, assertNodeVersion } from '../scripts/build-windows-release.js'
import { addWindowsAutostart } from '../scripts/build-windows-mod-release.js'

test('Windows release requires an explicit private Node distribution', () => {
  assert.throws(() => parseReleaseArgs([]), /--node-dir is required/)
  assert.throws(() => parseReleaseArgs(['--node-dir']), /Usage:/)
  assert.equal(basename(parseReleaseArgs(['--node-dir', './runtime'])['node-dir']), 'runtime')
})

test('Windows release rejects Node versions unsupported by Composer', () => {
  assert.throws(() => assertNodeVersion('v14.15.0'), />=22.19/)
  assert.throws(() => assertNodeVersion('v22.18.9'), />=22.19/)
  assert.doesNotThrow(() => assertNodeVersion('v22.19.0'))
  assert.doesNotThrow(() => assertNodeVersion('v24.0.0'))
})

test('marketplace Mod starts its bundled host on SessionStart', async () => {
  const controls = await mkdtemp(join(tmpdir(), 'voicemesh-windows-mod-'))
  try {
    await mkdir(join(controls, 'hooks'))
    await mkdir(join(controls, 'app', 'scripts'), { recursive: true })
    await writeFile(join(controls, 'hooks', 'hooks.json'), '{"modules":["./register.js"]}\n')
    await addWindowsAutostart(controls)
    const hooks = JSON.parse(await readFile(join(controls, 'hooks', 'hooks.json'), 'utf8'))
    assert.deepEqual(hooks.modules, ['./register.js'])
    assert.equal(hooks.hooks.SessionStart[0].hooks[0].command, '${CLAUDE_PLUGIN_ROOT}/runtime/node.exe')
    assert.deepEqual(hooks.hooks.SessionStart[0].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/app/scripts/bootstrap-host.js'])
    assert.match(await readFile(join(controls, 'app', 'scripts', 'bootstrap-host.js'), 'utf8'), /startBundledHost/)
  } finally {
    await rm(controls, { recursive: true, force: true })
  }
})
