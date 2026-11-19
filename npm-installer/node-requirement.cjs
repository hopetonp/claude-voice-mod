// Keep this module loadable by old Node so it can explain the prerequisite.
const { readFileSync, realpathSync } = require('fs')
const { join } = require('path')

const minimumNodeVersion = readFileSync(join(__dirname, 'node-minimum'), 'utf8').trim()

function assertNodeVersion(version = process.versions.node) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  const minimum = minimumNodeVersion.split('.').map(Number)
  const actual = match && match.slice(1).map(Number)
  const differing = actual && actual.findIndex((part, index) => part !== minimum[index])
  if (!actual || differing >= 0 && actual[differing] < minimum[differing]) {
    throw new Error(`VoiceMesh requires Node.js ${minimumNodeVersion} or later; found ${version.trim()}. Install Node from https://nodejs.org and run the installer again.`)
  }
}

exports.minimumNodeVersion = minimumNodeVersion
exports.assertNodeVersion = assertNodeVersion

if (require.main === module) {
  try {
    assertNodeVersion()
    if (process.argv[2] === '--resolve') console.log(realpathSync(process.execPath))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
