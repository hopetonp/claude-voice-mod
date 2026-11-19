#!/usr/bin/env node
const { assertNodeVersion } = require('./node-requirement.cjs')

// npm engines is advisory. Check before loading ESM or any newer Node built-ins.
try {
  assertNodeVersion()
  // pnpm dlx runs the binary after postinstall; only npm installs from postinstall.
  if (process.env.npm_lifecycle_event !== 'postinstall'
    || process.env.npm_command !== 'exec' && String(process.env.npm_config_user_agent || '').startsWith('npm/')) {
    import('./install.mjs').then(module => module.install()).catch(fail)
  }
} catch (error) { fail(error) }

function fail(error) {
  console.error('VoiceMesh installation failed: ' + error.message)
  process.exitCode = 1
}
