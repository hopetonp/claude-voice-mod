import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertNodeVersion, minimumNodeVersion } from '../npm-installer/node-requirement.cjs'

test('runtime minimum rejects unsupported versions and matches npm metadata', async () => {
  for (const version of ['20.20.0', '22.18.9', '22.19.0-rc.1', 'invalid']) {
    assert.throws(() => assertNodeVersion(version), /requires Node.js/)
  }
  for (const version of ['22.19.0', 'v22.19.1', '22.23.4', '24.0.0', '26.8.2']) assertNodeVersion(version)
  const pkg = JSON.parse(await readFile(new URL('../npm-installer/package.json', import.meta.url)))
  assert.equal(pkg.engines.node, `>=${minimumNodeVersion}`)
  assert.ok(pkg.files.includes('node-minimum') && pkg.files.includes('node-requirement.cjs'))
})

test('npm installer refuses old Node before any download', () => {
  const code = `Object.defineProperty(process.versions, 'node', {value:'14.15.0'});
    const Module = require('module'); const original = Module._load;
    Module._load = function(name, ...args) { if (name.startsWith('node:')) throw new Error('Old Node cannot load '+name); return original.call(this, name, ...args) };
    require('./npm-installer/check-node.cjs');`
  const result = spawnSync(process.execPath, ['-e', code], { cwd: resolve('.'), encoding: 'utf8' })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /requires Node.js 22.19.0 or later; found 14.15.0/)
  assert.doesNotMatch(result.stderr, /Old Node cannot load|ERR_UNKNOWN_BUILTIN_MODULE/)
})

test('npx and pnpm postinstall defer to the visible binary instead of installing twice', () => {
  for (const [agent, command] of [['npm/10.0.0', 'exec'], ['pnpm/10.0.0', 'dlx']]) {
    const result = spawnSync(process.execPath, ['npm-installer/check-node.cjs'], {
      env: { ...process.env, npm_lifecycle_event: 'postinstall', npm_config_user_agent: agent, npm_command: command }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
  }
})

test('actual old Node rejects the public entry point clearly', { skip: !process.env.VOICEMESH_TEST_OLD_NODE }, () => {
  const result = spawnSync(process.env.VOICEMESH_TEST_OLD_NODE, ['npm-installer/check-node.cjs'], { encoding: 'utf8' })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /requires Node.js 22.19.0 or later; found 14.15.0/)
  assert.doesNotMatch(result.stderr, /ERR_UNKNOWN_BUILTIN_MODULE|SyntaxError/)
})

test('macOS installer refuses missing and old Node before touching services or files', { skip: process.platform !== 'darwin' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'voicemesh-node-preflight-'))
  try {
    const bin = join(root, 'bin')
    await mkdir(bin)
    for (const [command, path] of [['cat', '/bin/cat'], ['dirname', '/usr/bin/dirname']]) await symlink(path, join(bin, command))
    const source = join(root, 'package with spaces')
    await mkdir(join(source, 'app/scripts'), { recursive: true })
    await mkdir(join(source, 'app/host'))
    await mkdir(join(source, 'plugin-marketplace'))
    await writeFile(join(source, 'app/host/server.js'), '')
    for (const file of ['node-minimum', 'node-requirement.cjs']) await copyFile(resolve('npm-installer', file), join(source, 'app/scripts', file))
    await copyFile(resolve('macos/install.sh'), join(source, 'install.sh'))
    const run = () => spawnSync('/bin/sh', [join(source, 'install.sh')], { env: { ...process.env, PATH: bin }, encoding: 'utf8' })
    const missing = run()
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /requires Node.js.*nodejs.org/)
    const patch = join(root, 'old-node.cjs')
    await writeFile(patch, "Object.defineProperty(process.versions, 'node', {value:'22.18.9'})")
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
    await writeFile(join(bin, 'node'), `#!/bin/sh\nexec ${quote(process.execPath)} --require ${quote(patch)} "$@"\n`)
    await chmod(join(bin, 'node'), 0o755)
    const old = run()
    assert.equal(old.status, 1)
    assert.match(old.stderr, /found 22.18.9/)
    assert.doesNotMatch(old.stderr, /launchctl|ditto|mkdir|rm:/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('macOS login shim diagnoses a removed saved Node without running JavaScript', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'voicemesh-node-shim-'))
  try {
    await mkdir(join(root, 'scripts'))
    for (const file of ['node-minimum', 'node-requirement.cjs']) await copyFile(resolve('npm-installer', file), join(root, 'scripts', file))
    await copyFile(resolve('scripts/launch-host.sh'), join(root, 'scripts/launch-host.sh'))
    await writeFile(join(root, 'node-path.txt'), '/missing/old-nvm-version/bin/node\n')
    const result = spawnSync('/bin/sh', [join(root, 'scripts/launch-host.sh')], { encoding: 'utf8' })
    assert.equal(result.status, 78)
    assert.match(result.stderr, /saved Node.js executable.*installer again/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
